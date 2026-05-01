from __future__ import annotations

import json
from pathlib import Path

from openai import OpenAI

from .config import TwinSettings
from .models import StyleProfile, TwinProfile


def _read_prompt(prompt_name: str) -> str:
    prompt_path = Path(__file__).resolve().parent / "prompts" / prompt_name
    return prompt_path.read_text(encoding="utf-8").strip()


class KimiTwinClient:
    def __init__(self, settings: TwinSettings) -> None:
        self.settings = settings
        self.client = OpenAI(api_key=settings.kimi_api_key, base_url=settings.kimi_base_url)

    def build_style_profile(self, name: str, corpus: str) -> StyleProfile:
        response = self.client.chat.completions.create(
            model=self.settings.kimi_profile_model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _read_prompt("style_profile.txt")},
                {"role": "user", "content": f"Person name: {name}\n\nWriting corpus:\n{corpus}"},
            ],
        )
        content = response.choices[0].message.content or "{}"
        payload = json.loads(content)
        return StyleProfile(
            summary=payload["summary"],
            tone=list(payload["tone"]),
            vocabulary_markers=list(payload["vocabulary_markers"]),
            structure_patterns=list(payload["structure_patterns"]),
            expertise_areas=list(payload["expertise_areas"]),
            do_not_mimic=list(payload["do_not_mimic"]),
            sample_hooks=list(payload["sample_hooks"]),
        )

    def generate_script(self, twin: TwinProfile, brief: str, output_format: str) -> str:
        normalized_format = {
            "podcast": "audio",
            "social": "script",
            "presentation": "video",
        }.get(output_format, output_format)
        prompt_file = {
            "audio": "podcast_script.txt",
            "video": "video_script.txt",
            "script": "social_post.txt",
        }.get(normalized_format, "podcast_script.txt")
        response = self.client.chat.completions.create(
            model=self.settings.kimi_generation_model,
            temperature=0.7,
            messages=[
                {"role": "system", "content": _read_prompt(prompt_file)},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "name": twin.name,
                            "style_profile": twin.style_profile.to_dict(),
                            "brief": brief,
                            "output_format": normalized_format,
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                },
            ],
        )
        return (response.choices[0].message.content or "").strip()
