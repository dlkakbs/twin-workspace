from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

from hermes_constants import get_hermes_home

from .config import load_twin_settings
from .elevenlabs_client import ElevenLabsTwinClient
from .heygen_cli import HeyGenCLIClient
from .interfaces import TwinTelephonyRuntime
from .models import (
    CallRecord,
    DelegationAuthority,
    DelegationContact,
    DelegationTask,
    GenerationResult,
    TwinProfile,
)
from .openai_client import OpenAITwinClient
from .profile_builder import load_writing_corpus
from .providers import HeyGenAvatarProvider
from .storage import TwinStorage, slugify, utc_timestamp
from .telephony_runtime import ElevenLabsConvAIRuntime

class TwinSkill:
    _TASK_TEMPLATES_TR = {
        "restaurant_inquiry": {
            "goal": "Bir restoranı arayıp uygun hafif seçenekleri, tahmini teslim süresini ve yaklaşık toplam tutarı öğren.",
            "opening": "Merhaba, hafif yemek seçeneklerinizi öğrenmek için aramıştım.",
            "rules": [
                "Görevi karşı taraftan isteme; ne için aradığını zaten biliyorsun.",
                "Bilgi topla, seçenekleri karşılaştır, ama açık onay olmadan siparişi kesinleştirme.",
                "Ödeme bilgisi verme.",
                "Karşı taraf sadece 'buyurun' veya kısa bir karşılama yaparsa small talk yapma; doğrudan arama sebebini tek cümlede söyle.",
                "Karşı taraf açıkça 'nasılsınız' diye sormadıkça 'iyiyim, teşekkür ederim' gibi sosyal cevaplarla vakit kaybetme.",
                "Bu görevde 'ödeme konusunda bilgi almak istiyorum' deme; yalnızca yaklaşık toplam tutarı sor.",
                "Soruları aşamalı sor. İlk olarak hafif seçenekleri sor, sonra teslimat süresine geç, en sonda yaklaşık toplam tutarı sor.",
                "İlk cümlede tek bir hedef söyle; bütün kontrol listesini aynı anda sıralama.",
                "Karşı taraf bir alanı zaten cevapladıysa aynı alanı tekrar sorma; bir sonraki eksik bilgiye geç.",
                "Karşı taraf soru sorarsa doğal şekilde cevap ver ve görüşmeyi ana hedefte tut.",
            ],
        },
        "restaurant_reservation": {
            "goal": "Bir restoranı arayıp uygun rezervasyon saatlerini ve şartları öğren; uygunsa rezervasyonu son aşamaya kadar getir ama açık onay olmadan kesinleştirme.",
            "opening": "Merhaba, bu akşam için uygun rezervasyon saatlerini öğrenmek için aramıştım.",
            "rules": [
                "Kişi sayısını, uygun saatleri ve varsa şartları netleştir.",
                "Karşı taraf alternatif saat verirse karşılaştırılabilir şekilde toparla.",
                "Karşı taraf doğrudan uygun bir saat veya şart söylediyse bunu yeni bilgi olarak kabul et; aynı öneriyi soru gibi tekrar etme.",
                "Henüz netleşmemiş tek noktayı sor; cevaplanan kişisayısı/saat/şart bilgisini yeniden başa sarma.",
                "Açık onay olmadan rezervasyonu kesinleştirme.",
            ],
        },
        "hotel_reservation": {
            "goal": "Bir oteli arayıp uygun oda seçeneklerini, fiyat aralığını ve rezervasyon koşullarını öğren.",
            "opening": "Merhaba, uygun oda seçenekleri ve rezervasyon koşulları hakkında kısa bilgi almak için aramıştım.",
            "rules": [
                "Tarih, fiyat, iptal koşulu ve uygun oda tiplerini netleştir.",
                "Karşı taraf tarih, oda tipi veya fiyat bilgisini verdiyse aynı slotu tekrar sorma; sıradaki eksik bilgiye geç.",
                "Açık onay olmadan rezervasyonu kesinleştirme.",
                "Gereksiz meta konuşma yapma; doğrudan müşteri gibi konuş.",
            ],
        },
        "availability_check": {
            "goal": "Uygunluk durumunu netleştirmek için kısa ve hedef odaklı bir görüşme yap.",
            "opening": "Merhaba, uygunluk durumunu hızlıca kontrol etmek için aramıştım.",
            "rules": [
                "Önce neyin uygun olup olmadığını netleştir: saat, masa, oda, ürün veya hizmet.",
                "Gereksiz ayrıntıya girmeden tarih, saat ve temel kısıtları sırayla sor.",
                "Karşı taraf doğrudan bir saat veya zaman aralığı önerirse bunu yeni bilgi olarak kabul et; aynı öneriyi soru gibi tekrar etme.",
                "Karşı tarafın verdiği saat istenen aralığa uyuyorsa kısa bir teyit veya teşekkürle ilerle; aynı uygunluk sorusunu yeniden kurma.",
                "Karşı taraf uygun değil derse aynı noktayı zorlamadan varsa en yakın alternatifi bir kez sor.",
                "Açık onay olmadan herhangi bir rezervasyon veya taahhüt kesinleştirme.",
            ],
        },
        "pricing_request": {
            "goal": "Bir hizmetin veya seçeneğin fiyatını, varsa ek ücretleri ve yaklaşık toplam maliyeti öğren.",
            "opening": "Merhaba, fiyat bilgisi almak için aramıştım.",
            "rules": [
                "Önce ana fiyatı sor, sonra gerekiyorsa ek ücretleri ve toplam aralığı netleştir.",
                "Karşı taraf birden fazla seçenek verirse kısa ve karşılaştırılabilir şekilde toparla.",
                "Karşı taraf ana fiyatı veya ek ücreti söylediyse aynı fiyat bilgisini yeniden sorma; yalnızca eksik kalan maliyet parçasını netleştir.",
                "Basit zihinsel hesap gerektiren indirim, yüzde, toplam ve fark hesaplarını konuşma içinde kendin yap. Bunun için 'hesap yapamıyorum' deme.",
                "Karşı taraf 'siz hesaplayın' veya benzeri bir şey söylerse kısa hesabı yap, sonucu doğal biçimde söyle, sonra gerekiyorsa teyit sorusu sor.",
                "Ödeme bilgisi verme ve satın alma taahhüdünde bulunma.",
                "Belirsiz fiyat cevabı gelirse kibarca yaklaşık toplamı veya fiyat aralığını netleştir.",
            ],
        },
        "follow_up_call": {
            "goal": "Önceki bir görüşmenin devamı olarak açık kalan noktaları netleştir ve sonucu toparla.",
            "opening": "Merhaba, önceki konuşmamızı takip etmek için aramıştım.",
            "rules": [
                "Kısa bir bağlam cümlesi ver ve doğrudan açık kalan konuya geç.",
                "Önceki konuşmada netleşmeyen tek tek maddeleri sırayla kapat.",
                "Bir madde cevaplandıysa onu kapandı kabul et ve aynı maddeyi farklı cümleyle yeniden açma.",
                "Yeni bir taahhüt gerekiyorsa açık onay olmadan bunu verme.",
                "Görüşme sonunda net sonucu ve varsa sonraki adımı kısa şekilde teyit et.",
            ],
        },
        "custom_request": {
            "goal": "Özel bir isteği netleştirmek ve gerekli bilgileri toplamak için kontrollü bir görüşme yürüt.",
            "opening": "Merhaba, kısa bir konuda bilgi almak için aramıştım.",
            "rules": [
                "İlk olarak asıl isteği netleştir, sonra yalnızca gerekli takip sorularını sor.",
                "Belirsiz veya alışılmadık bir ifade duyarsan eminmiş gibi davranma; kısa bir netleştirme sorusu sor.",
                "Karşı taraf bir soruyu net biçimde cevapladıysa aynı bilgiyi sadece kelime değiştirerek tekrar isteme.",
                "Karşı taraf olumsuz veya kesin bir cevap verdiyse aynı noktada gereksiz ısrar etme.",
                "Açık onay olmadan taahhüt, ödeme veya rezervasyon kesinleştirme.",
            ],
        },
        "content_creation": {
            "goal": "Bir içerik üretim işini verilen brief'e göre yürüt.",
            "opening": "Merhaba, içerik briefini işliyorum.",
            "rules": [
                "Bu modda içerik üretim işi vardır; telefon görüşmesi davranışı uygulama.",
                "Goal ve context içinde verilen brief'i öncelikli kabul et.",
                "Eksik kritik bilgi varsa bunu açıkça belirt, uydurma detay ekleme.",
            ],
        },
    }
    _TASK_TEMPLATES_EN = {
        "restaurant_inquiry": {
            "goal": "Call a restaurant to learn about suitable light options, estimated delivery time, and the approximate total cost.",
            "opening": "Hello, I was calling to ask about your lighter menu options.",
            "rules": [
                "Do not ask the other person to define the task; you already know why you are calling.",
                "Gather information and compare options, but do not finalize an order without explicit approval.",
                "Do not share payment information.",
                "If the other person only says a brief greeting such as 'hello' or 'how can I help', skip small talk and state the reason for the call in one sentence.",
                "Do not say 'I'm good, thank you' unless the other person explicitly asks how you are.",
                "Do not say 'I want information about payment'; instead ask for the approximate total cost only.",
                "Ask questions in stages. First ask about light options, then delivery time, and finally the approximate total.",
                "State only one target in the first substantive sentence; do not dump the whole checklist at once.",
                "If the other person already answered one slot, do not ask for the same slot again; move to the next missing piece of information.",
                "If the other person asks a question, answer naturally and keep the conversation on task.",
            ],
        },
        "restaurant_reservation": {
            "goal": "Call a restaurant to learn available reservation times and conditions; if suitable, bring the reservation close to completion without finalizing it without explicit approval.",
            "opening": "Hello, I was calling to check available reservation times for this evening.",
            "rules": [
                "Clarify party size, available times, and any conditions.",
                "If the other person offers alternatives, summarize them in a comparable way.",
                "If the other person directly gives a suitable time or condition, treat it as new information; do not repeat it back as a fresh question.",
                "Ask only for the one remaining unresolved point; do not reopen already answered party-size, time, or condition details.",
                "Do not finalize the reservation without explicit approval.",
            ],
        },
        "hotel_reservation": {
            "goal": "Call a hotel to learn about available room options, price range, and reservation conditions.",
            "opening": "Hello, I was calling to get quick information about available room options and reservation terms.",
            "rules": [
                "Clarify dates, price, cancellation policy, and suitable room types.",
                "If the other person already provided the date, room type, or price, do not ask for the same slot again; move to the next missing detail.",
                "Do not finalize the reservation without explicit approval.",
                "Avoid meta talk; speak directly like a real customer.",
            ],
        },
        "availability_check": {
            "goal": "Have a short, goal-focused conversation to clarify availability.",
            "opening": "Hello, I was calling to quickly check availability.",
            "rules": [
                "First clarify what is or is not available: a time, table, room, product, or service.",
                "Ask for the date, time, and core constraints in order without unnecessary detail.",
                "If the other person directly suggests a time or time window, treat it as new information; do not repeat the same suggestion back as a question.",
                "If the suggested time fits the requested range, move forward with a short confirmation or thanks instead of rebuilding the same availability question.",
                "If the requested time is unavailable, ask for the nearest alternative once without pushing the same point repeatedly.",
                "Do not finalize a booking or commitment without explicit approval.",
            ],
        },
        "pricing_request": {
            "goal": "Learn the price of a service or option, any extra fees, and the approximate total cost.",
            "opening": "Hello, I was calling to ask about pricing.",
            "rules": [
                "Ask for the base price first, then clarify extra fees and the approximate total if needed.",
                "If the other person gives multiple options, summarize them briefly and comparatively.",
                "If the other person already gave the base price or an extra fee, do not ask for the same number again; only clarify the missing cost component.",
                "Do simple mental math for discounts, percentages, totals, and differences during the call. Do not say you cannot calculate.",
                "If the other person says something like 'you do the math', calculate the simple result, state it naturally, and then ask the next clarifying question if needed.",
                "Do not share payment information or commit to a purchase.",
                "If the answer is vague, politely clarify the approximate total or the price range.",
            ],
        },
        "follow_up_call": {
            "goal": "Continue a previous conversation, close open points, and summarize the result.",
            "opening": "Hello, I was calling to follow up on our previous conversation.",
            "rules": [
                "Give a short context sentence, then move directly to the open point.",
                "Close unresolved items one by one.",
                "If an item has already been answered, treat it as closed and do not reopen it with a rephrased version of the same question.",
                "If a new commitment would be required, do not make it without explicit approval.",
                "At the end, briefly confirm the result and any next step.",
            ],
        },
        "custom_request": {
            "goal": "Handle a custom request with a controlled conversation that clarifies the need and gathers the necessary information.",
            "opening": "Hello, I was calling about a quick matter.",
            "rules": [
                "Clarify the main request first, then ask only the follow-up questions that are actually needed.",
                "If something sounds ambiguous or unusual, do not act certain; ask a short clarification question.",
                "If the other person clearly answered a question, do not ask for the same information again with different wording.",
                "If the answer is clearly negative or final, do not push the same point unnecessarily.",
                "Do not finalize commitments, payments, or reservations without explicit approval.",
            ],
        },
        "content_creation": {
            "goal": "Carry out a content generation task according to the provided brief.",
            "opening": "Hello, I'm processing the content brief.",
            "rules": [
                "In this mode there is a content task; do not apply phone-call behavior.",
                "Treat the provided goal and context as the primary brief.",
                "If critical information is missing, say so explicitly and do not invent details.",
            ],
        },
    }

    def _build_spoken_script(self, raw_script: str) -> str:
        spoken_lines: list[str] = []
        for line in raw_script.splitlines():
            text = line.strip()
            if not text:
                continue
            # Drop stage directions before passing narration to HeyGen.
            if text.startswith("[") and text.endswith("]"):
                continue
            if text.startswith('"') and text.endswith('"') and len(text) >= 2:
                text = text[1:-1].strip()
            if text:
                spoken_lines.append(text)
        return "\n".join(spoken_lines).strip() or raw_script.strip()

    def _is_turkish_language(self, language: str | None) -> bool:
        return (language or "tr-TR").split("-")[0].lower() == "tr"

    def __init__(self, project_root: Path | None = None) -> None:
        self.project_root = (project_root or Path(__file__).resolve().parents[2]).resolve()
        load_dotenv(get_hermes_home() / ".env", override=False)
        self.settings = load_twin_settings(self.project_root)
        self.storage = TwinStorage(self.settings.output_root)
        self.storage.ensure()
        self.openai = OpenAITwinClient(self.settings)
        self.elevenlabs = ElevenLabsTwinClient(self.settings)
        self.heygen = HeyGenCLIClient(self.settings)
        self.telephony_runtime: TwinTelephonyRuntime = ElevenLabsConvAIRuntime()

    def _resolve_avatar_provider(self):
        if self.settings.avatar_provider != "heygen":
            raise ValueError(f"Unsupported avatar provider: {self.settings.avatar_provider}")
        return HeyGenAvatarProvider(self.settings)

    def setup_profile(
        self,
        *,
        name: str,
        photo_path: Path,
        voice_sample_path: Path,
        writing_sample_paths: list[Path],
        clone_voice: bool = True,
    ) -> dict:
        slug = slugify(name)
        profile_dir = self.storage.profile_dir(slug)
        assets_dir = self.storage.profile_assets_dir(slug)
        photo_copy = self.storage.copy_asset(photo_path, assets_dir)
        voice_copy = self.storage.copy_asset(voice_sample_path, assets_dir)
        documents, corpus = load_writing_corpus(writing_sample_paths)
        for sample_path in writing_sample_paths:
            self.storage.copy_asset(sample_path, assets_dir)
        style_profile = self.openai.build_style_profile(name=name, corpus=corpus)
        voice_id = self.elevenlabs.clone_voice(name=name, sample_path=voice_copy) if clone_voice else None
        heygen_voice_id = None
        heygen_avatar_group_id = None
        heygen_avatar_id = None
        if self.settings.avatar_provider == "heygen":
            heygen_voice_id = self.heygen.clone_voice(name=name, audio_path=voice_copy)
            heygen_avatar_group_id, heygen_avatar_id = self.heygen.create_photo_avatar(name=name, image_path=photo_copy)
        twin = TwinProfile(
            slug=slug,
            name=name,
            photo_path=str(photo_copy),
            voice_sample_path=str(voice_copy),
            writing_samples=documents,
            style_profile=style_profile,
            voice_id=voice_id,
            avatar_provider=self.settings.avatar_provider,
            heygen_avatar_id=heygen_avatar_id,
            heygen_avatar_group_id=heygen_avatar_group_id,
            heygen_voice_id=heygen_voice_id,
            metadata={"profile_dir": str(profile_dir)},
        )
        profile_path = self.storage.save_profile(twin)
        return {"profile_path": str(profile_path), "profile": twin.to_dict()}

    def generate(
        self,
        *,
        profile_path: Path,
        brief: str,
        output_format: str,
        with_avatar: bool = True,
        source_script_path: Path | None = None,
        source_audio_path: Path | None = None,
    ) -> dict:
        output_format = {
            "podcast": "audio",
            "social": "script",
            "presentation": "video",
        }.get(output_format, output_format)
        twin = TwinProfile.from_dict(self.storage.read_json(profile_path))
        needs_audio_output = output_format in {"audio", "video"}
        if needs_audio_output and not twin.voice_id and not source_audio_path:
            raise RuntimeError("Twin profile has no ElevenLabs voice_id. Re-run setup with cloning enabled.")
        run_id = utc_timestamp()
        run_dir = self.storage.run_dir(twin.slug, run_id)
        run_dir.mkdir(parents=True, exist_ok=True)

        if source_script_path:
            script = source_script_path.read_text(encoding="utf-8").strip()
        else:
            script = self.openai.generate_script(twin=twin, brief=brief, output_format=output_format)
        script_path = run_dir / "script.txt"
        script_path.write_text(script, encoding="utf-8")

        audio_path: Path | None = None
        if needs_audio_output:
            if source_audio_path:
                provided_audio_path = source_audio_path.expanduser().resolve()
                copied_audio_path = run_dir / f"narration{provided_audio_path.suffix.lower() or '.mp3'}"
                copied_audio_path.write_bytes(provided_audio_path.read_bytes())
                audio_path = copied_audio_path
            else:
                audio_path = self.elevenlabs.text_to_speech(
                    voice_id=twin.voice_id,
                    text=script,
                    output_path=run_dir / "narration.mp3",
                )

        video_path: Path | None = None
        if with_avatar and output_format == "video":
            if audio_path is None:
                raise RuntimeError("Video generation requires an audio track.")
            if self.settings.avatar_provider == "heygen":
                if not twin.heygen_avatar_id or not twin.heygen_voice_id:
                    raise RuntimeError("Twin profile has no HeyGen avatar/voice IDs. Re-run setup with HeyGen enabled.")
                orientation = twin.default_video_orientation if getattr(twin, "default_video_orientation", None) else "portrait"
                if source_audio_path:
                    video_path = self.heygen.generate_video_from_audio(
                        avatar_id=twin.heygen_avatar_id,
                        audio_path=audio_path,
                        orientation=orientation,
                        output_path=run_dir / "avatar.mp4",
                        title=f"{twin.name} {output_format} {run_id}",
                    )
                else:
                    spoken_script = self._build_spoken_script(script)
                    video_prompt = (
                        "Create a short video in the user's established style. "
                        f"Use this exact narration as the spoken script:\n\n{spoken_script}"
                    )
                    video_path = self.heygen.generate_video(
                        prompt=video_prompt,
                        avatar_id=twin.heygen_avatar_id,
                        voice_id=twin.heygen_voice_id,
                        orientation=orientation,
                        output_path=run_dir / "avatar.mp4",
                    )
            else:
                provider = self._resolve_avatar_provider()
                video_path = provider.generate_video(
                    image_path=Path(twin.photo_path),
                    audio_path=audio_path,
                    output_path=run_dir / "avatar.mp4",
                    name=f"{twin.name} {output_format} {run_id}",
                )

        result = GenerationResult(
            run_id=run_id,
            profile_path=str(profile_path),
            format=output_format,
            brief=brief,
            script_path=str(script_path),
            audio_path=str(audio_path) if audio_path else None,
            video_path=str(video_path) if video_path else None,
        )
        manifest_path = self.storage.write_json(run_dir / "manifest.json", result.to_dict())
        result.manifest_path = str(manifest_path)
        return result.to_dict()

    def _task_template(self, task_type: str, language: str = "tr-TR") -> dict:
        templates = self._TASK_TEMPLATES_TR if self._is_turkish_language(language) else self._TASK_TEMPLATES_EN
        return templates.get(task_type, templates["custom_request"])

    def _video_meeting_intent(self, task: DelegationTask) -> str:
        metadata_intent = str((task.metadata or {}).get("video_meeting_intent") or "").strip().lower()
        if metadata_intent in {"intro", "follow_up", "custom"}:
            return metadata_intent
        if task.task_type == "follow_up_call":
            return "follow_up"
        return "custom"

    def _video_meeting_template(self, intent: str, language: str = "tr-TR") -> dict:
        is_tr = self._is_turkish_language(language)
        templates_tr = {
            "intro": {
                "goal": "İlk tanışma veya giriş görüşmesini sıcak, doğal ve net biçimde yürüt; güven oluştur ve sonraki adımı netleştir.",
                "opening": "Merhaba, tanışıp kısa bir çerçeve çizmek için bu görüşmeyi planlamıştım.",
                "rules": [
                    "Bu bir telefon araması değil, planlı bir video görüşmesi çerçevesinde konuş.",
                    "Açılışı kısa ve doğal tut; bot gibi resmiyete kaçma.",
                    "İlk birkaç turda amaç, bağlam ve karşı taraftan beklenen katkıyı netleştir.",
                    "Small talk gelirse kısa ve sıcak cevap ver ama görüşme amacını kaybetme.",
                    "Görüşme sonunda net bir sonraki adım, karar veya takip maddesi bırak.",
                ],
            },
            "follow_up": {
                "goal": "Önceki görüşme veya yazışmadan kalan açık maddeleri video görüşmesinde kapat ve net bir karar ya da sonraki adım çıkar.",
                "opening": "Merhaba, önceki konuşmamızı devam ettirip açık kalan noktaları netleştirmek istedim.",
                "rules": [
                    "Bu görüşmenin daha önceki bir bağlamın devamı olduğunu doğal biçimde hissettir.",
                    "Önceden konuşulmuş noktaları kısa özetle; aynı şeyi baştan kurma.",
                    "Açık maddeleri tek tek kapat ve cevaplanan konuyu yeniden açma.",
                    "Karşı tarafın verdiği yeni kararı, kısıtı veya zamanı net biçimde teyit et.",
                    "Görüşmeyi net kapanış ve takip maddesiyle bitir.",
                ],
            },
            "custom": {
                "goal": "Özel amaçlı bir video görüşmesini doğal, kontrollü ve sonuç odaklı biçimde yürüt.",
                "opening": "Merhaba, bugün kısa bir konuda birlikte netleşmek istedim.",
                "rules": [
                    "Bu bir telefon araması değil, planlı bir video görüşmesi çerçevesinde konuş.",
                    "Görüşmenin amacını erken netleştir ve konuşmayı o çerçevede tut.",
                    "Karşı taraf zaten bir bilgi verdiyse aynı bilgiyi farklı cümleyle yeniden isteme.",
                    "Belirsiz veya kritik bir noktada varsayım yapma; kısa netleştirme sorusu sor.",
                    "Görüşme sonunda karar, açık konu veya sonraki adımı kısa şekilde toparla.",
                ],
            },
        }
        templates_en = {
            "intro": {
                "goal": "Lead a first meeting naturally and warmly, build trust quickly, and leave the conversation with a clear next step.",
                "opening": "Hello, I set up this meeting so we could meet briefly and align on the context.",
                "rules": [
                    "Frame this as a scheduled video meeting, not a cold phone call.",
                    "Keep the opening short and natural instead of overly formal or robotic.",
                    "Use the first few turns to clarify purpose, context, and what the other person should contribute.",
                    "If small talk appears, respond warmly but keep the meeting on track.",
                    "Close with a concrete next step, decision, or follow-up item.",
                ],
            },
            "follow_up": {
                "goal": "Use the meeting to close open items from an earlier conversation or thread and leave with a clear next step or decision.",
                "opening": "Hello, I wanted to continue our earlier discussion and close the remaining open points.",
                "rules": [
                    "Make it feel like a continuation of prior context rather than a first outreach.",
                    "Briefly recap the prior context without restarting the whole conversation.",
                    "Close open items one by one and do not reopen points that are already answered.",
                    "Confirm any new decision, timing, or constraint clearly.",
                    "End with a crisp follow-up or decision summary.",
                ],
            },
            "custom": {
                "goal": "Run a custom video meeting naturally, with control and a clear outcome.",
                "opening": "Hello, I wanted us to use this short meeting to get aligned on one topic.",
                "rules": [
                    "Frame this as a scheduled video meeting, not a cold phone call.",
                    "Clarify the meeting objective early and keep the conversation anchored to it.",
                    "If the other person already answered a point, do not ask for the same point again with different wording.",
                    "Do not assume ambiguous or critical details; ask a short clarification question.",
                    "End by summarizing the decision, open issue, or next action briefly.",
                ],
            },
        }
        templates = templates_tr if is_tr else templates_en
        return templates.get(intent, templates["custom"])

    def _default_first_message(self, twin: TwinProfile) -> str:
        if self._is_turkish_language(twin.language):
            if twin.calling_identity_mode == "assistant_on_behalf":
                return f"Merhaba, {twin.name} adına arıyorum."
            return f"Merhaba, ben {twin.name}."
        if twin.calling_identity_mode == "assistant_on_behalf":
            return f"Hello, I'm calling on behalf of {twin.name}."
        return f"Hello, I'm {twin.name}."

    def _calling_identity_instructions(self, twin: TwinProfile) -> str:
        is_tr = self._is_turkish_language(twin.language)
        if twin.calling_identity_mode == "assistant_on_behalf":
            if not is_tr:
                return (
                    f"Identity framing:\n"
                    f"- Do not present yourself as literally being {twin.name}.\n"
                    f"- Speak naturally in an 'I'm calling on behalf of {twin.name}' frame.\n"
                    f"- If the other person assumes you are directly {twin.name}, clarify that you are calling for them when needed.\n"
                    f"- Do not drift into meta explanations about AI, digital twins, or bots.\n"
                    f"- Be clear, concise, and task-focused like an assistant without impersonating personal identity.\n"
                )
            return (
                f"Kimlik sunumu:\n"
                f"- Kendini doğrudan {twin.name} olarak sunma.\n"
                f"- Doğal biçimde '{twin.name} adına arıyorum' veya '{twin.name} için arıyorum' çerçevesinde konuş.\n"
                f"- Karşı taraf seni doğrudan {twin.name} sanarsa belirsiz bırakma; gerektiğinde onun adına aradığını netleştir.\n"
                f"- Meta seviyede AI, dijital ikiz, bot gibi açıklamalara girme.\n"
                f"- Bir asistan gibi net, kısa ve görev odaklı ol ama kişisel kimlik taklidi yapma.\n"
            )
        if not is_tr:
            return (
                f"Identity framing:\n"
                f"- Use first person and speak naturally as {twin.name}.\n"
                f"- Do not use meta labels such as assistant, representative, extension, or digital twin.\n"
                f"- Do not position yourself in the third person.\n"
            )
        return (
            f"Kimlik sunumu:\n"
            f"- Birinci tekil şahıs kullan ve doğal biçimde {twin.name} olarak konuş.\n"
            f"- Meta seviyede asistan, temsilci, uzantı veya dijital ikiz gibi ifadeler kullanma.\n"
            f"- Kendini üçüncü şahıs gibi konumlama.\n"
        )

    def _build_live_call_prompt(self, twin: TwinProfile, task: DelegationTask) -> str:
        style = twin.style_profile
        is_video_meeting = task.channel == "video_call"
        template = (
            self._video_meeting_template(self._video_meeting_intent(task), twin.language)
            if is_video_meeting
            else self._task_template(task.task_type, twin.language)
        )
        opening_line = twin.first_message or self._default_first_message(twin)
        identity_instructions = self._calling_identity_instructions(twin)
        is_tr = self._is_turkish_language(twin.language)
        lang = (twin.language or "tr-TR").split("-")[0].lower()
        language_instruction = (
            "Dil kuralı:\n"
            "- Bu görüşmeyi Türkçe yürüt.\n"
            "- Karşı taraf açıkça başka bir dil istemedikçe İngilizceye geçme.\n"
            "- Türkçe seçiliyken karışık dil kullanma.\n"
        ) if lang == "tr" else (
            "Language rule:\n"
            "- Conduct this call in English.\n"
            "- Do not switch to Turkish unless the other person explicitly asks for it.\n"
            "- Keep the conversation consistently in English.\n"
        )
        if is_video_meeting:
            language_instruction = (
                "Dil kuralı:\n"
                "- Bu video görüşmesini Türkçe yürüt.\n"
                "- Karşı taraf açıkça başka bir dil istemedikçe İngilizceye geçme.\n"
                "- Türkçe seçiliyken karışık dil kullanma.\n"
            ) if lang == "tr" else (
                "Language rule:\n"
                "- Conduct this video meeting in English.\n"
                "- Do not switch to Turkish unless the other person explicitly asks for it.\n"
                "- Keep the conversation consistently in English.\n"
            )
        context_lines = "\n".join(f"- {item}" for item in task.context_notes) or ("- Ek bağlam verilmedi" if is_tr else "- No extra context provided")
        success_lines = "\n".join(f"- {item}" for item in task.success_criteria) or ("- Görüşmeden net bir sonuç ve sonraki adım çıkar" if is_tr else "- Leave the conversation with a clear result and next step")
        autonomous_lines = "\n".join(f"- {item}" for item in task.authority.autonomous_actions) or ("- Yalnızca bilgi toplama ve netleştirme" if is_tr else "- Information gathering and clarification only")
        approval_lines = "\n".join(f"- {item}" for item in task.authority.approval_required) or ("- Açık onay gerektiren noktaları kesinleştirme" if is_tr else "- Do not finalize anything that requires explicit approval")
        forbidden_lines = "\n".join(f"- {item}" for item in task.authority.forbidden_actions) or ("- Hassas kararları kesinleştirme" if is_tr else "- Do not finalize sensitive decisions")
        task_rules = "\n".join(f"- {item}" for item in template["rules"])
        if not is_tr:
            interaction_noun = "video meeting" if is_video_meeting else "call"
            beyond_authority_line = (
                "- Politely say: 'I'll confirm that and follow up right after this meeting.' or 'I'll review that and send the next step.'\n\n"
                if is_video_meeting
                else "- Politely say: 'I'll confirm that and get back to you.' or 'I'll review that and call you back.'\n\n"
            )
            opening_guidance = (
                f"- After saying '{opening_line}' in the first turn, if the other person gives only a short greeting, move directly into the meeting purpose in the second turn.\n"
                if is_video_meeting
                else f"- After saying '{opening_line}' in the first turn, if the other person gives only a short greeting, state the reason for the call directly in the second turn.\n"
            )
            return (
                f"You are Twin. In this {interaction_noun} you are speaking for {twin.name}.\n\n"
                f"Do not talk about being a separate AI, bot, or digital twin.\n\n"
                f"{identity_instructions}\n"
                f"{language_instruction}\n"
                f"Identity and tone:\n"
                f"- Be clear, calm, concise, controlled, and natural.\n"
                f"- {twin.name}'s writing/style summary: {style.summary}\n"
                f"- Tone markers: {', '.join(style.tone) or 'clear'}\n"
                f"- Do not speak at unnecessary length.\n"
                f"- Ask only one question at a time.\n"
                f"- Keep the conversation fluid based on what the other person says.\n\n"
                f"Task for this {interaction_noun}:\n"
                f"- Task type: {task.task_type}\n"
                f"- Primary objective: {task.goal or template['goal']}\n"
                f"- Suggested short opening: {template['opening']}\n\n"
                f"Task-specific rules:\n"
                f"{task_rules}\n\n"
                f"Context:\n"
                f"{context_lines}\n\n"
                f"Actions you are allowed to take:\n"
                f"{autonomous_lines}\n\n"
                f"Areas that require approval:\n"
                f"{approval_lines}\n\n"
                f"Things you must not do:\n"
                f"{forbidden_lines}\n\n"
                f"If the conversation reaches a point beyond your authority:\n"
                f"- Do not make a final decision.\n"
                f"{beyond_authority_line}"
                f"Conversation goals:\n"
                f"{success_lines}\n\n"
                f"Very important:\n"
                f"{opening_guidance}"
                f"- After introducing yourself, do not say 'Hello' again in the next turn. Move straight into the purpose.\n"
                f"- Do not say things like 'I'm good, thank you' unless the other person explicitly asks.\n"
                f"- Do not drift into a frame where the other person has to tell you why you are there or what task you want from them.\n"
                f"- You already know the purpose; begin naturally and keep the {interaction_noun} on that objective.\n"
                f"- Do not use meta phrases like 'I am an extension of {twin.name}'.\n"
                f"- If you are not fully sure what the other person meant, do not act as if you are certain. Say 'Sorry, I didn't fully catch that' or 'What exactly do you mean by that?'\n"
                f"- Do not lock onto a single interpretation of an ambiguous or odd-sounding phrase and then insist on it. Clarify first, then continue.\n"
                f"- If the other person gives a clear negative answer like 'no', 'we don't have that', or 'that's not available', do not keep pushing the same point.\n"
                f"- If it becomes clear the requested thing is unavailable, thank them briefly, ask once if there is an alternative if relevant, and then close the conversation.\n"
                f"- If there is a risk of misunderstanding, step back and ask a short clarification question instead of repeatedly reinterpreting the same phrase.\n"
                f"- If the other person has already answered what you asked, do not ask for the same content again with slightly different wording. Process the answer first, then move to the next needed step.\n"
                f"- Do not repeat the other person's answer in stiff reported-speech like 'you stated that...' or 'you mentioned that...'. Use a very short acknowledgment, then move to the next question.\n"
                f"- Do not turn the call into a spoken meeting summary. Unless a critical number needs verification, avoid restating the full answer back to the other person.\n"
                f"- If the call requires simple arithmetic such as a discount, percentage, total, or difference, do the math briefly and naturally in the conversation instead of refusing.\n"
                f"- Do not end the call on your own unless the objective is clearly complete, the other person is explicitly ending the conversation, or they say they are unavailable and want to stop.\n"
                f"- If there is still an open question, unresolved detail, or useful next step, ask one short follow-up question instead of closing.\n"
                f"- Do not use call-center closing lines like 'Can I help with anything else?'\n"
                f"- Keep the selected conversation language consistent.\n"
            )
        interaction_noun = "video görüşme" if is_video_meeting else "görüşme"
        beyond_authority_line = (
            "- Kibarca: 'Bu kısmı netleştirip görüşmeden hemen sonra size döneceğim.' veya 'Bunu gözden geçirip sonraki adımı paylaşacağım.' de.\n\n"
            if is_video_meeting
            else "- Kibarca: 'Bu kısmı netleştirip size döneceğim.' veya 'Bunu gözden geçirip tekrar arayacağım.' de.\n\n"
        )
        opening_guidance = (
            f"- İlk turda '{opening_line}' dedikten sonra karşı taraf kısa bir karşılama yaparsa, ikinci turda doğrudan görüşme amacına geç.\n"
            if is_video_meeting
            else f"- İlk turda '{opening_line}' dedikten sonra karşı taraf kısa bir karşılama yaparsa, ikinci turda doğrudan arama sebebini söyle.\n"
        )
        return (
            f"Sen Twin'sin. Bu {interaction_noun}de {twin.name} için konuşuyorsun.\n\n"
            f"Bu görüşmede ayrı bir AI, bot veya dijital ikiz hakkında meta konuşma yapma.\n\n"
            f"{identity_instructions}\n"
            f"{language_instruction}\n"
            f"Kimlik ve ton:\n"
            f"- Net, sakin, kısa, kontrollü ve doğal ol.\n"
            f"- {twin.name} için yazı/stil özeti: {style.summary}\n"
            f"- Ton işaretleri: {', '.join(style.tone) or 'net'}\n"
            f"- Gereksiz uzun konuşma yapma.\n"
            f"- Aynı anda tek bir soru sor.\n"
            f"- Karşı tarafın söylediklerine göre sohbeti akıcı sürdür.\n\n"
            f"Bu {interaction_noun}nin görevi:\n"
            f"- Task type: {task.task_type}\n"
            f"- Asıl amaç: {task.goal or template['goal']}\n"
            f"- Kısa açılış cümlesi: {template['opening']}\n\n"
            f"Bu görev için özel kurallar:\n"
            f"{task_rules}\n\n"
            f"Görev bağlamı:\n"
            f"{context_lines}\n\n"
            f"Yetkili olduğun alanlar:\n"
            f"{autonomous_lines}\n\n"
            f"Onay gerektiren alanlar:\n"
            f"{approval_lines}\n\n"
            f"Kesinlikle yapmaman gerekenler:\n"
            f"{forbidden_lines}\n\n"
            f"Yetkini aşan bir noktaya gelirsen şöyle davran:\n"
            f"- Kesin karar verme.\n"
            f"{beyond_authority_line}"
            f"Görüşme hedefleri:\n"
            f"{success_lines}\n\n"
            f"Çok önemli:\n"
            f"{opening_guidance}"
            f"- İlk cümlede kendini tanıttıktan sonra ikinci turda yeniden 'Merhaba' deme. Doğrudan konuya gir.\n"
            f"- Karşı taraf açıkça sormadıkça 'iyiyim, teşekkür ederim' gibi sosyal cevaplar verme.\n"
            f"- 'Ödeme konusunda bilgi almak istiyorum' deme; doğru ifade 'yaklaşık toplam tutarı öğrenmek istiyorum' olsun.\n"
            f"- Karşı taraftan 'beni neden aradın, ne yapmamı istiyorsun' gibi bir görev alma moduna kayma.\n"
            f"- Sen zaten görüşmenin nedenini biliyorsun; doğal biçimde başla ve konuşmayı o hedefte tut.\n"
            f"- Meta seviyede 'ben {twin.name}'in uzantısıyım' gibi ifadeler kullanma.\n"
            f"- Karşı tarafın söylediği bir ifadeden tam emin değilsen, duyduğunu kesin doğruymuş gibi varsayma. "
            f"Kibarca 'Tam anlayamadım, tekrar edebilir misiniz?' veya 'Tam olarak neyi kastediyorsunuz?' diye sor.\n"
            f"- Belirsiz veya kulağa garip gelen bir ifadeyi tek olası anlamla sabitleyip üstüne ısrar etme. Önce doğrula, sonra devam et.\n"
            f"- Karşı taraf 'yok', 'bizde yok', 'mevcut değil', 'maalesef yok' gibi net bir olumsuz yanıt verirse aynı noktayı tekrar tekrar zorlama.\n"
            f"- İstenen şeyin mevcut olmadığı netleşirse kısa şekilde teşekkür et, gerekirse alternatif olup olmadığını bir kez sor, sonra konuşmayı kapat.\n"
            f"- Yanlış anlama ihtimali varsa aynı ifadeyi tekrar tekrar yorumlamak yerine bir adım geri çekil ve kısa bir netleştirme sorusu sor.\n"
            f"- Karşı taraf senin sorduğun şeyi cevapladıysa, aynı içeriği sadece kelime değiştirerek yeniden sorma. Önce verilen cevabı işle, sonra gerekiyorsa bir sonraki adıma geç.\n"
            f"- Karşı tarafın cevabını 'belirttiniz', 'söylediniz', 'anladım yani...' gibi resmî rapor diliyle uzun uzun tekrar etme. Çok kısa bir onay ver ve doğrudan sonraki soruya geç.\n"
            f"- Görüşmeyi sözlü toplantı özeti gibi yürütme. Kritik bir sayı veya ayrıntıyı teyit etmen gerekmiyorsa, cevabın tamamını karşı tarafa geri okuma.\n"
            f"- Görüşme içinde basit indirim, yüzde, toplam veya fark hesabı gerekiyorsa kısa zihinsel hesabı yap ve doğal biçimde söyle; 'hesap yapamıyorum' deme.\n"
            f"- Amaç net biçimde tamamlanmadan, karşı taraf açıkça kapatmadan veya meşgul olduğunu söyleyip bitirmek istemeden görüşmeyi kendi başına sonlandırma.\n"
            f"- Hâlâ açık soru, eksik ayrıntı veya faydalı bir sonraki adım varsa kapanış cümlesi kurmak yerine tek bir kısa takip sorusu sor.\n"
            f"- 'Başka bir konuda yardımcı olabilir miyim?' gibi çağrı merkezi kapanış cümleleri kullanma.\n"
            f"- Seçilen konuşma dilini tutarlı biçimde koru.\n"
        )

    def _build_delegation_brief(self, twin: TwinProfile, task: DelegationTask) -> str:
        style = twin.style_profile
        is_video_meeting = task.channel == "video_call"
        template = (
            self._video_meeting_template(self._video_meeting_intent(task), twin.language)
            if is_video_meeting
            else self._task_template(task.task_type, twin.language)
        )
        is_tr = self._is_turkish_language(twin.language)
        meeting_intent = self._video_meeting_intent(task) if is_video_meeting else None
        identity_summary = (
            f"Speak as {twin.name} in first person."
            if twin.calling_identity_mode != "assistant_on_behalf"
            else f"Speak on behalf of {twin.name}; do not present yourself as literally being {twin.name}."
        )
        context_lines = "\n".join(f"- {item}" for item in task.context_notes) or ("- Ek bağlam verilmedi" if is_tr else "- None provided")
        success_lines = "\n".join(f"- {item}" for item in task.success_criteria) or ("- Sonucu netleştir ve kaydet" if is_tr else "- Clarify the result and log it")
        autonomous_lines = "\n".join(f"- {item}" for item in task.authority.autonomous_actions) or ("- Otonom aksiyon belirtilmedi" if is_tr else "- No autonomous actions specified")
        approval_lines = "\n".join(f"- {item}" for item in task.authority.approval_required) or ("- Onay noktası belirtilmedi" if is_tr else "- No approval checkpoints specified")
        forbidden_lines = "\n".join(f"- {item}" for item in task.authority.forbidden_actions) or ("- Yasak aksiyon belirtilmedi" if is_tr else "- No forbidden actions specified")
        spending_line = task.authority.spending_limit or ("Harcama limiti belirtilmedi" if is_tr else "No spending limit specified")
        meeting_intent_line_tr = f"Görüşme niyeti: {meeting_intent}\n" if meeting_intent else ""
        meeting_intent_line_en = f"Meeting intent: {meeting_intent}\n" if meeting_intent else ""
        if is_tr:
            return (
                f"# Twin Delegation Brief\n\n"
                f"Principal: {twin.name}\n"
                f"Temsil biçimi: {identity_summary}\n"
                f"Zamanlama: {task.scheduled_for or 'Zamanlanmadı'}\n"
                f"Kanal: {task.channel}\n\n"
                f"Görev tipi: {task.task_type}\n"
                f"{meeting_intent_line_tr}"
                f"## Karşı taraf\n"
                f"- İsim: {task.counterpart.name}\n"
                f"- Organizasyon: {task.counterpart.organization or 'Bilinmiyor'}\n"
                f"- Rol: {task.counterpart.role or 'Bilinmiyor'}\n"
                f"- Telefon: {task.counterpart.phone_number or 'Bilinmiyor'}\n"
                f"- İlişki: {task.counterpart.relationship or 'Bilinmiyor'}\n\n"
                f"## Amaç\n"
                f"{task.goal}\n\n"
                f"## Önerilen Açılış\n"
                f"{template['opening']}\n\n"
                f"## Stil Çapaları\n"
                f"- Özet: {style.summary}\n"
                f"- Ton: {', '.join(style.tone) or 'Yok'}\n"
                f"- Kelime işaretleri: {', '.join(style.vocabulary_markers) or 'Yok'}\n"
                f"- Yapı kalıpları: {', '.join(style.structure_patterns) or 'Yok'}\n\n"
                f"## Bağlam Notları\n"
                f"{context_lines}\n\n"
                f"## Başarı Kriterleri\n"
                f"{success_lines}\n\n"
                f"## Yetki\n"
                f"Otonom aksiyonlar:\n{autonomous_lines}\n\n"
                f"Onay gerektirenler:\n{approval_lines}\n\n"
                f"Yasak olanlar:\n{forbidden_lines}\n\n"
                f"Harcama limiti: {spending_line}\n\n"
                f"## Çıktı Gereksinimleri\n"
                f"- Sonucu net şekilde kaydet\n"
                f"- Çözülmemiş soruları not et\n"
                f"- {twin.name} için sonraki adımları yakala\n"
            )
        return (
            f"# Twin Delegation Brief\n\n"
            f"Principal: {twin.name}\n"
            f"Delegate persona: {identity_summary}\n"
            f"Scheduled for: {task.scheduled_for or 'Unscheduled'}\n"
            f"Channel: {task.channel}\n\n"
            f"Task type: {task.task_type}\n"
            f"{meeting_intent_line_en}"
            f"## Counterpart\n"
            f"- Name: {task.counterpart.name}\n"
            f"- Organization: {task.counterpart.organization or 'Unknown'}\n"
            f"- Role: {task.counterpart.role or 'Unknown'}\n"
            f"- Phone: {task.counterpart.phone_number or 'Unknown'}\n"
            f"- Relationship: {task.counterpart.relationship or 'Unknown'}\n\n"
            f"## Goal\n"
            f"{task.goal}\n\n"
            f"## Suggested Opening\n"
            f"{template['opening']}\n\n"
            f"## Style Anchors\n"
            f"- Summary: {style.summary}\n"
            f"- Tone: {', '.join(style.tone) or 'None'}\n"
            f"- Vocabulary markers: {', '.join(style.vocabulary_markers) or 'None'}\n"
            f"- Structure patterns: {', '.join(style.structure_patterns) or 'None'}\n\n"
            f"## Context Notes\n"
            f"{context_lines}\n\n"
            f"## Success Criteria\n"
            f"{success_lines}\n\n"
            f"## Authority\n"
            f"Autonomous actions:\n{autonomous_lines}\n\n"
            f"Approval required:\n{approval_lines}\n\n"
            f"Forbidden actions:\n{forbidden_lines}\n\n"
            f"Spending limit: {spending_line}\n\n"
            f"## Output Requirements\n"
            f"- Log the outcome clearly\n"
            f"- Record unresolved questions\n"
            f"- Capture next steps for {twin.name}\n"
        )

    def create_delegation(
        self,
        *,
        profile_path: Path,
        counterpart_name: str,
        goal: str,
        scheduled_for: str | None = None,
        channel: str = "voice_call",
        counterpart_phone: str | None = None,
        counterpart_organization: str | None = None,
        counterpart_role: str | None = None,
        relationship: str | None = None,
        title: str | None = None,
        task_type: str = "custom_request",
        context_notes: list[str] | None = None,
        success_criteria: list[str] | None = None,
        autonomous_actions: list[str] | None = None,
        approval_required: list[str] | None = None,
        forbidden_actions: list[str] | None = None,
        spending_limit: str | None = None,
        content_subtype: str | None = None,
        video_meeting_intent: str | None = None,
        video_meeting_setup: str | None = None,
    ) -> dict:
        twin = TwinProfile.from_dict(self.storage.read_json(profile_path))
        delegation_id = utc_timestamp()
        delegation_title = title or f"{counterpart_name} - {goal[:72].strip()}"
        counterpart = DelegationContact(
            name=counterpart_name,
            organization=counterpart_organization,
            role=counterpart_role,
            phone_number=counterpart_phone,
            relationship=relationship,
        )
        authority = DelegationAuthority(
            autonomous_actions=list(autonomous_actions or []),
            approval_required=list(approval_required or []),
            forbidden_actions=list(forbidden_actions or []),
            spending_limit=spending_limit,
        )
        metadata: dict[str, str] = {}
        if content_subtype:
            metadata["content_subtype"] = content_subtype
        if video_meeting_intent:
            metadata["video_meeting_intent"] = video_meeting_intent
        if video_meeting_setup:
            metadata["video_meeting_setup"] = video_meeting_setup
        task = DelegationTask(
            delegation_id=delegation_id,
            profile_path=str(profile_path),
            principal_name=twin.name,
            title=delegation_title,
            task_type=task_type,
            channel=channel,
            goal=goal,
            scheduled_for=scheduled_for,
            counterpart=counterpart,
            authority=authority,
            context_notes=list(context_notes or []),
            success_criteria=list(success_criteria or []),
            metadata=metadata,
        )
        delegation_dir = self.storage.delegation_dir(twin.slug, delegation_id)
        delegation_dir.mkdir(parents=True, exist_ok=True)
        briefing_path = delegation_dir / "briefing.md"
        briefing_path.write_text(self._build_delegation_brief(twin, task), encoding="utf-8")
        task.briefing_path = str(briefing_path)
        delegation_path = self.storage.write_json(
            self.storage.delegation_json_path(twin.slug, delegation_id),
            task.to_dict(),
        )
        return {
            "delegation_path": str(delegation_path),
            "briefing_path": str(briefing_path),
            "live_call_prompt": self._build_live_call_prompt(twin, task),
            "delegation": task.to_dict(),
        }

    def update_delegation(
        self,
        *,
        delegation_path: Path,
        counterpart_name: str,
        goal: str,
        scheduled_for: str | None = None,
        channel: str = "voice_call",
        counterpart_phone: str | None = None,
        counterpart_organization: str | None = None,
        counterpart_role: str | None = None,
        relationship: str | None = None,
        title: str | None = None,
        task_type: str = "custom_request",
        context_notes: list[str] | None = None,
        success_criteria: list[str] | None = None,
        autonomous_actions: list[str] | None = None,
        approval_required: list[str] | None = None,
        forbidden_actions: list[str] | None = None,
        spending_limit: str | None = None,
        content_subtype: str | None = None,
        video_meeting_intent: str | None = None,
        video_meeting_setup: str | None = None,
        video_generation_mode: str | None = None,
    ) -> dict:
        path = Path(delegation_path).expanduser().resolve()
        existing = DelegationTask.from_dict(self.storage.read_json(path))
        twin = TwinProfile.from_dict(self.storage.read_json(Path(existing.profile_path)))

        counterpart = DelegationContact(
            name=counterpart_name,
            organization=counterpart_organization,
            role=counterpart_role,
            phone_number=counterpart_phone,
            relationship=relationship,
        )
        authority = DelegationAuthority(
            autonomous_actions=list(autonomous_actions or []),
            approval_required=list(approval_required or []),
            forbidden_actions=list(forbidden_actions or []),
            spending_limit=spending_limit,
        )
        metadata: dict[str, object] = dict(existing.metadata or {})
        metadata.pop("pre_call_approved_at", None)
        if content_subtype:
            metadata["content_subtype"] = content_subtype
        else:
            metadata.pop("content_subtype", None)
        if video_meeting_intent:
            metadata["video_meeting_intent"] = video_meeting_intent
        else:
            metadata.pop("video_meeting_intent", None)
        if video_meeting_setup:
            metadata["video_meeting_setup"] = video_meeting_setup
        else:
            metadata.pop("video_meeting_setup", None)
        if video_generation_mode:
            metadata["video_generation_mode"] = video_generation_mode
        else:
            metadata.pop("video_generation_mode", None)

        updated = DelegationTask(
            delegation_id=existing.delegation_id,
            profile_path=existing.profile_path,
            principal_name=twin.name,
            title=title or f"{counterpart_name} - {goal[:72].strip()}",
            task_type=task_type,
            channel=channel,
            goal=goal,
            scheduled_for=scheduled_for,
            counterpart=counterpart,
            authority=authority,
            context_notes=list(context_notes or []),
            success_criteria=list(success_criteria or []),
            status="planned" if existing.status in {"planned", "scheduled"} else existing.status,
            briefing_path=existing.briefing_path,
            latest_call_path=existing.latest_call_path,
            metadata=metadata,
        )
        briefing_path = Path(updated.briefing_path) if updated.briefing_path else path.parent / "briefing.md"
        briefing_path.write_text(self._build_delegation_brief(twin, updated), encoding="utf-8")
        updated.briefing_path = str(briefing_path)
        saved_path = self.storage.write_json(path, updated.to_dict())
        return {
            "delegation_path": str(saved_path),
            "briefing_path": str(briefing_path),
            "live_call_prompt": self._build_live_call_prompt(twin, updated),
            "delegation": updated.to_dict(),
        }

    def delegation_prompt(self, *, delegation_path: Path) -> dict:
        task = DelegationTask.from_dict(self.storage.read_json(delegation_path))
        twin = TwinProfile.from_dict(self.storage.read_json(Path(task.profile_path)))
        return {
            "delegation_path": str(delegation_path),
            "task_type": task.task_type,
            "opening": (
                self._video_meeting_template(self._video_meeting_intent(task), twin.language)["opening"]
                if task.channel == "video_call"
                else self._task_template(task.task_type)["opening"]
            ),
            "live_call_prompt": self._build_live_call_prompt(twin, task),
        }

    def call_run(self, *, delegation_path: Path) -> dict:
        task = DelegationTask.from_dict(self.storage.read_json(delegation_path))
        twin = TwinProfile.from_dict(self.storage.read_json(Path(task.profile_path)))
        if not task.counterpart.phone_number:
            raise RuntimeError("Delegation has no counterpart phone number.")
        if not twin.voice_id:
            raise RuntimeError("Twin profile has no ElevenLabs voice_id configured.")

        run_id = utc_timestamp()
        run_dir = self.storage.delegation_calls_dir(twin.slug, task.delegation_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        opening_line = twin.first_message or self._default_first_message(twin)
        live_call_prompt = self._build_live_call_prompt(twin, task)
        runtime_result = self.telephony_runtime.run_outbound_call(
            twin=twin,
            task=task,
            prompt=live_call_prompt,
            first_message=opening_line,
        )

        manifest = {
            "run_id": run_id,
            "delegation_path": str(delegation_path),
            "delegation_id": task.delegation_id,
            "task_type": task.task_type,
            "counterpart_name": task.counterpart.name,
            "to_number": task.counterpart.phone_number,
            "conversation_id": runtime_result.get("conversation_id"),
            "call_sid": runtime_result.get("call_sid"),
            "status": runtime_result.get("status"),
            "opening": opening_line,
            "live_call_prompt": live_call_prompt,
            "agent_config_excerpt": runtime_result.get("agent_config_excerpt", {}),
        }
        manifest_path = self.storage.write_json(run_dir / f"{run_id}_call_run.json", manifest)
        task.status = "running"
        task.latest_call_path = str(manifest_path)
        self.storage.write_json(delegation_path, task.to_dict())
        return {
            "delegation_path": str(delegation_path),
            "call_run_path": str(manifest_path),
            "conversation_id": manifest["conversation_id"],
            "call_sid": manifest["call_sid"],
            "status": manifest["status"],
            "to_number": task.counterpart.phone_number,
        }

    def log_call(
        self,
        *,
        delegation_path: Path,
        status: str,
        summary: str,
        outcome: str,
        next_steps: list[str] | None = None,
        pending_approvals: list[str] | None = None,
        post_call_followups: list[str] | None = None,
        pending_actions: list[str] | None = None,
        notes: list[str] | None = None,
        transcript_path: Path | None = None,
    ) -> dict:
        task = DelegationTask.from_dict(self.storage.read_json(delegation_path))
        profile_path = Path(task.profile_path)
        twin = TwinProfile.from_dict(self.storage.read_json(profile_path))
        call_id = utc_timestamp()
        calls_dir = self.storage.delegation_calls_dir(twin.slug, task.delegation_id)
        calls_dir.mkdir(parents=True, exist_ok=True)
        record = CallRecord(
            call_id=call_id,
            delegation_id=task.delegation_id,
            status=status,
            summary=summary,
            outcome=outcome,
            next_steps=list(next_steps or []),
            pending_approvals=list(pending_approvals or []),
            post_call_followups=list(post_call_followups or []),
            pending_actions=list(pending_actions or []),
            transcript_path=str(transcript_path) if transcript_path else None,
            notes=list(notes or []),
            created_at=call_id,
        )
        call_path = self.storage.write_json(calls_dir / f"{call_id}.json", record.to_dict())
        task.status = status
        task.latest_call_path = str(call_path)
        self.storage.write_json(delegation_path, task.to_dict())
        return {
            "call_path": str(call_path),
            "delegation_path": str(delegation_path),
            "call": record.to_dict(),
        }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build and use a local Twin digital twin.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    setup_parser = subparsers.add_parser("setup", help="Create a new twin profile from local assets.")
    setup_parser.add_argument("--name", required=True)
    setup_parser.add_argument("--photo", required=True)
    setup_parser.add_argument("--voice", required=True)
    setup_parser.add_argument("--writing-sample", action="append", required=True, dest="writing_samples")
    setup_parser.add_argument("--skip-voice-clone", action="store_true")

    generate_parser = subparsers.add_parser("generate", help="Generate a new asset package from an existing twin profile.")
    generate_parser.add_argument("--profile", required=True)
    generate_parser.add_argument(
        "--format",
        choices=["audio", "script", "video", "podcast", "social", "presentation"],
        required=True,
    )
    generate_parser.add_argument("--brief", required=True)
    generate_parser.add_argument("--no-avatar", action="store_true")
    generate_parser.add_argument("--source-script")
    generate_parser.add_argument("--source-audio")

    delegate_parser = subparsers.add_parser("delegate-create", help="Create a delegation task for Twin to execute later.")
    delegate_parser.add_argument("--profile", required=True)
    delegate_parser.add_argument("--counterpart-name", required=True)
    delegate_parser.add_argument("--goal", required=True)
    delegate_parser.add_argument("--scheduled-for")
    delegate_parser.add_argument("--channel", default="voice_call")
    delegate_parser.add_argument("--counterpart-phone")
    delegate_parser.add_argument("--counterpart-organization")
    delegate_parser.add_argument("--counterpart-role")
    delegate_parser.add_argument("--relationship")
    delegate_parser.add_argument("--title")
    delegate_parser.add_argument(
        "--task-type",
        choices=["restaurant_inquiry", "restaurant_reservation", "hotel_reservation", "availability_check", "pricing_request", "follow_up_call", "custom_request", "content_creation"],
        default="custom_request",
    )
    delegate_parser.add_argument("--content-subtype")
    delegate_parser.add_argument("--video-meeting-intent", choices=["intro", "follow_up", "custom"])
    delegate_parser.add_argument("--context-note", action="append", dest="context_notes")
    delegate_parser.add_argument("--success-criterion", action="append", dest="success_criteria")
    delegate_parser.add_argument("--autonomous-action", action="append", dest="autonomous_actions")
    delegate_parser.add_argument("--approval-required", action="append", dest="approval_required")
    delegate_parser.add_argument("--forbidden-action", action="append", dest="forbidden_actions")
    delegate_parser.add_argument("--spending-limit")

    call_log_parser = subparsers.add_parser("call-log", help="Attach a call outcome to an existing delegation.")
    call_log_parser.add_argument("--delegation", required=True)
    call_log_parser.add_argument(
        "--status",
        required=True,
        choices=["completed", "needs_follow_up", "blocked", "cancelled", "failed"],
    )
    call_log_parser.add_argument("--summary", required=True)
    call_log_parser.add_argument("--outcome", required=True)
    call_log_parser.add_argument("--next-step", action="append", dest="next_steps")
    call_log_parser.add_argument("--note", action="append", dest="notes")
    call_log_parser.add_argument("--transcript")

    prompt_parser = subparsers.add_parser("delegate-prompt", help="Render the live call prompt for a delegation.")
    prompt_parser.add_argument("--delegation", required=True)

    call_run_parser = subparsers.add_parser("call-run", help="Configure the live agent for a delegation and start the call.")
    call_run_parser.add_argument("--delegation", required=True)
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    skill = TwinSkill()

    if args.command == "setup":
        result = skill.setup_profile(
            name=args.name,
            photo_path=Path(args.photo).expanduser().resolve(),
            voice_sample_path=Path(args.voice).expanduser().resolve(),
            writing_sample_paths=[Path(path).expanduser().resolve() for path in args.writing_samples],
            clone_voice=not args.skip_voice_clone,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "generate":
        result = skill.generate(
            profile_path=Path(args.profile).expanduser().resolve(),
            brief=args.brief,
            output_format=args.format,
            with_avatar=not args.no_avatar,
            source_script_path=Path(args.source_script).expanduser().resolve() if args.source_script else None,
            source_audio_path=Path(args.source_audio).expanduser().resolve() if args.source_audio else None,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "delegate-create":
        result = skill.create_delegation(
            profile_path=Path(args.profile).expanduser().resolve(),
            counterpart_name=args.counterpart_name,
            goal=args.goal,
            scheduled_for=args.scheduled_for,
            channel=args.channel,
            counterpart_phone=args.counterpart_phone,
            counterpart_organization=args.counterpart_organization,
            counterpart_role=args.counterpart_role,
            relationship=args.relationship,
            title=args.title,
            task_type=args.task_type,
            context_notes=args.context_notes,
            success_criteria=args.success_criteria,
            autonomous_actions=args.autonomous_actions,
            approval_required=args.approval_required,
            forbidden_actions=args.forbidden_actions,
            spending_limit=args.spending_limit,
            content_subtype=args.content_subtype,
            video_meeting_intent=args.video_meeting_intent,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "delegate-prompt":
        result = skill.delegation_prompt(
            delegation_path=Path(args.delegation).expanduser().resolve(),
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "call-run":
        result = skill.call_run(
            delegation_path=Path(args.delegation).expanduser().resolve(),
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "call-log":
        result = skill.log_call(
            delegation_path=Path(args.delegation).expanduser().resolve(),
            status=args.status,
            summary=args.summary,
            outcome=args.outcome,
            next_steps=args.next_steps,
            notes=args.notes,
            transcript_path=Path(args.transcript).expanduser().resolve() if args.transcript else None,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2
