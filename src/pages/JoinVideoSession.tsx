import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Mic, MicOff, PhoneOff, RefreshCw, Video, VideoOff } from 'lucide-react'
import {
  Room,
  RoomEvent,
  Track,
  type TrackPublication,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client'

import { api, type VideoSession } from '../lib/api'
import { formatUserFacingError, humanizeEnvKey } from '../lib/userFacingErrors'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'

type MediaPublication = LocalTrackPublication | RemoteTrackPublication | undefined

function firstPublication<T extends LocalTrackPublication | RemoteTrackPublication>(
  publications: Map<string, T> | undefined,
  kind: 'video' | 'audio'
): T | undefined {
  if (!publications) return undefined
  const candidates = Array.from(publications.values())
  return candidates.find((publication) => {
    if (!publication.isSubscribed) return false
    if (kind === 'video') return Boolean(publication.videoTrack)
    return Boolean(publication.audioTrack)
  })
}

function hasTrack(publication: TrackPublication | undefined, kind: 'video' | 'audio') {
  if (!publication || !publication.isSubscribed) return false
  if (kind === 'video') {
    return publication.kind === Track.Kind.Video && Boolean(publication.track)
  }
  return publication.kind === Track.Kind.Audio && Boolean(publication.track)
}

function participantPublicationSummary(participant: RemoteParticipant) {
  const publications = Array.from(participant.trackPublications.values())
  const videoPublication = publications.find((publication) => hasTrack(publication, 'video'))
  const audioPublication = publications.find((publication) => hasTrack(publication, 'audio'))
  return {
    participant,
    videoPublication,
    audioPublication,
  }
}

function publicationDebugSummary(publication: TrackPublication) {
  return `${publication.kind}:${publication.source}:${publication.isSubscribed ? 'subscribed' : 'unsubscribed'}:${publication.track ? 'track' : 'no-track'}`
}

function participantLabel(participant: RemoteParticipant) {
  return (participant.name || participant.identity || participant.sid || '').toLowerCase()
}

function MediaTile({
  publication,
  audioPublication,
  title,
  emptyLabel,
  debugLabel,
  mirrored = false,
}: {
  publication: MediaPublication
  audioPublication?: MediaPublication
  title: string
  emptyLabel: string
  debugLabel?: string
  mirrored?: boolean
}) {
  const mediaContainerRef = useRef<HTMLDivElement | null>(null)
  const audioContainerRef = useRef<HTMLDivElement | null>(null)
  const trackSid = publication?.trackSid ?? `${title}-empty`
  const videoTrack =
    publication?.videoTrack ??
    (publication?.track?.kind === Track.Kind.Video ? publication.track : undefined)
  const audioTrack = (
    audioPublication?.audioTrack ??
    (audioPublication?.track?.kind === Track.Kind.Audio ? audioPublication.track : undefined) ??
    publication?.audioTrack ??
    (publication?.track?.kind === Track.Kind.Audio ? publication.track : undefined)
  )

  useEffect(() => {
    const mediaContainer = mediaContainerRef.current
    const audioContainer = audioContainerRef.current
    if (!mediaContainer || !audioContainer) return
    mediaContainer.replaceChildren()
    audioContainer.replaceChildren()

    const attached: HTMLElement[] = []

    if (videoTrack) {
      const element = videoTrack.attach()
      element.className = `h-full w-full object-cover${mirrored ? ' scale-x-[-1]' : ''}`
      element.autoplay = true
      element.setAttribute('playsinline', 'true')
      if (mirrored) {
        element.muted = true
      }
      mediaContainer.appendChild(element)
      void element.play().catch(() => undefined)
      attached.push(element)
    }

    if (audioTrack) {
      const element = audioTrack.attach()
      element.className = 'hidden'
      element.autoplay = true
      element.setAttribute('playsinline', 'true')
      audioContainer.appendChild(element)
      void element.play().catch(() => undefined)
      attached.push(element)
    }

    return () => {
      attached.forEach((element) => element.remove())
      videoTrack?.detach()
      audioTrack?.detach()
    }
  }, [audioTrack, mirrored, trackSid, videoTrack])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        <p className="text-xs text-[var(--text-muted)]">
          {videoTrack ? 'video' : audioTrack ? 'audio only' : 'waiting'}
        </p>
      </div>
      <div className="aspect-video overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-muted)]">
        {videoTrack || audioTrack ? (
          <>
            <div ref={mediaContainerRef} className="h-full w-full bg-black" />
            <div ref={audioContainerRef} className="hidden" />
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--text-muted)]">
            {emptyLabel}
          </div>
        )}
      </div>
      {debugLabel ? <p className="text-xs text-[var(--text-muted)]">{debugLabel}</p> : null}
    </div>
  )
}

export function JoinVideoSession() {
  const { inviteToken } = useParams<{ inviteToken: string }>()
  const [session, setSession] = useState<VideoSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [roomState, setRoomState] = useState('idle')
  const [room, setRoom] = useState<Room | null>(null)
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([])
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false)
  const roomCleanupRef = useRef<(() => void) | null>(null)

  const localVideoPublication =
    room?.localParticipant.getTrackPublication(Track.Source.Camera) ??
    firstPublication(room?.localParticipant.videoTrackPublications, 'video')
  const localAudioPublication =
    room?.localParticipant.getTrackPublication(Track.Source.Microphone) ??
    firstPublication(room?.localParticipant.audioTrackPublications, 'audio')
  const remoteSummaries = remoteParticipants.map(participantPublicationSummary)
  const remoteVideoSummary =
    remoteSummaries.find((item) => item.videoPublication) ??
    null
  const remoteAudioSummary =
    remoteSummaries.find((item) => participantLabel(item.participant).includes('twin bot') && item.audioPublication) ??
    remoteSummaries.find((item) => participantLabel(item.participant).includes('twin-bot') && item.audioPublication) ??
    remoteSummaries.find((item) => item.audioPublication) ??
    null
  const remotePrimary = remoteVideoSummary?.participant ?? remoteAudioSummary?.participant ?? null
  const remoteVideoPublication = remoteVideoSummary?.videoPublication
  const remoteAudioPublication = remoteAudioSummary?.audioPublication
  const remoteDebugLabel = remoteParticipants.length
    ? remoteParticipants
        .map((participant) => {
          const publications = Array.from(participant.trackPublications.values())
            .map(publicationDebugSummary)
            .join(' | ')
          return `${participant.name || participant.identity || participant.sid}: ${publications || 'no publications'}`
        })
        .join(' || ')
    : 'No remote participants detected in the room yet.'

  const joinArtifacts = session?.browser_join?.artifacts
  const joinReady =
    session?.browser_join?.status === 'browser_join_ready' &&
    Boolean(joinArtifacts?.livekit_url) &&
    Boolean(joinArtifacts?.livekit_user_token_present)

  const joinBlockedReason = useMemo(() => {
    if (!session) return 'Invite not loaded yet.'
    if (session.browser_join?.status === 'session_ended') return 'This session has already ended.'
    if (joinReady) return ''
    if (session.browser_join?.missing?.length) {
      return `The meeting setup is still incomplete: ${session.browser_join.missing.map(humanizeEnvKey).join(', ')}`
    }
    return 'Live session bootstrap is not ready yet.'
  }, [joinReady, session])

  const roomStateLabel = useMemo(() => {
    switch (roomState) {
      case 'connected':
        return 'You are in the call'
      case 'connecting':
        return 'Joining the meeting...'
      case 'disconnected':
        return 'You left the call'
      case 'failed':
        return 'Could not join the meeting'
      case 'ended':
        return 'This meeting has ended'
      default:
        return joinReady ? 'Ready to join' : 'Preparing the meeting'
    }
  }, [joinReady, roomState])

  const roomStateVariant = useMemo(() => {
    switch (roomState) {
      case 'connected':
        return 'success' as const
      case 'connecting':
        return 'info' as const
      case 'failed':
      case 'ended':
        return 'danger' as const
      default:
        return joinReady ? ('info' as const) : ('muted' as const)
    }
  }, [joinReady, roomState])

  function syncRoomState(activeRoom: Room) {
    setRemoteParticipants(Array.from(activeRoom.remoteParticipants.values()))
    setCameraEnabled(activeRoom.localParticipant.isCameraEnabled)
    setMicrophoneEnabled(activeRoom.localParticipant.isMicrophoneEnabled)
    setRoomState(activeRoom.state)
  }

  function bindRoom(activeRoom: Room) {
    const handleConnected = () => {
      syncRoomState(activeRoom)
      setRoomState('connected')
    }
    const handleDisconnected = () => {
      syncRoomState(activeRoom)
      setRoomState('disconnected')
    }
    const handleConnectionStateChanged = () => {
      syncRoomState(activeRoom)
    }
    const handleTrackChanged = () => {
      syncRoomState(activeRoom)
    }
    const handleMediaError = (err: Error) => {
      setJoinError(formatUserFacingError(err.message, 'Browser media device error.'))
    }

    syncRoomState(activeRoom)

    activeRoom
      .on(RoomEvent.Connected, handleConnected)
      .on(RoomEvent.Disconnected, handleDisconnected)
      .on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
      .on(RoomEvent.ParticipantConnected, handleTrackChanged)
      .on(RoomEvent.ParticipantDisconnected, handleTrackChanged)
      .on(RoomEvent.TrackSubscribed, handleTrackChanged)
      .on(RoomEvent.TrackUnsubscribed, handleTrackChanged)
      .on(RoomEvent.LocalTrackPublished, handleTrackChanged)
      .on(RoomEvent.LocalTrackUnpublished, handleTrackChanged)
      .on(RoomEvent.TrackMuted, handleTrackChanged)
      .on(RoomEvent.TrackUnmuted, handleTrackChanged)
      .on(RoomEvent.MediaDevicesError, handleMediaError)

    return () => {
      activeRoom
        .off(RoomEvent.Connected, handleConnected)
        .off(RoomEvent.Disconnected, handleDisconnected)
        .off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
        .off(RoomEvent.ParticipantConnected, handleTrackChanged)
        .off(RoomEvent.ParticipantDisconnected, handleTrackChanged)
        .off(RoomEvent.TrackSubscribed, handleTrackChanged)
        .off(RoomEvent.TrackUnsubscribed, handleTrackChanged)
        .off(RoomEvent.LocalTrackPublished, handleTrackChanged)
        .off(RoomEvent.LocalTrackUnpublished, handleTrackChanged)
        .off(RoomEvent.TrackMuted, handleTrackChanged)
        .off(RoomEvent.TrackUnmuted, handleTrackChanged)
        .off(RoomEvent.MediaDevicesError, handleMediaError)
    }
  }

  async function loadInvite(token: string, keepRoom = false) {
    setLoading(true)
    try {
      const payload = await api.videoSessions.resolveInvite(token)
      setSession(payload)
      setError('')
      if (!keepRoom && payload.browser_join?.status === 'session_ended' && room) {
        await room.disconnect()
        setRoom(null)
        setRemoteParticipants([])
        setRoomState('ended')
      }
    } catch (err) {
      setError(formatUserFacingError(err instanceof Error ? err.message : '', 'Invite could not be resolved.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!inviteToken) {
      setError('Invite token missing.')
      setLoading(false)
      return
    }

    void loadInvite(inviteToken)
  }, [inviteToken])

  useEffect(() => {
    return () => {
      roomCleanupRef.current?.()
      roomCleanupRef.current = null
      if (room) {
        void room.disconnect()
      }
    }
  }, [room])

  async function joinCall() {
    if (!session || !joinArtifacts?.livekit_url || !session.browser_join?.artifacts.livekit_user_token_present) {
      setJoinError(joinBlockedReason || 'Join payload is not ready yet.')
      return
    }

    const livekitUserToken = ((session.runtime?.runner_plan as Record<string, unknown> | undefined)?.livekit as
      | Record<string, unknown>
      | undefined)?.user_token
    if (typeof livekitUserToken !== 'string' || !livekitUserToken) {
      setJoinError('Guest token is missing from the invite payload.')
      return
    }

    setJoining(true)
    setJoinError('')
    setRoomState('connecting')

    const nextRoom = new Room()
    try {
      roomCleanupRef.current?.()
      roomCleanupRef.current = bindRoom(nextRoom)
      await nextRoom.connect(joinArtifacts.livekit_url, livekitUserToken)
      await nextRoom.startAudio()
      await nextRoom.localParticipant.setCameraEnabled(true)
      await nextRoom.localParticipant.setMicrophoneEnabled(true)
      setRoom(nextRoom)
      syncRoomState(nextRoom)
      setRoomState('connected')
      window.setTimeout(() => syncRoomState(nextRoom), 0)
      window.setTimeout(() => syncRoomState(nextRoom), 500)
    } catch (err) {
      roomCleanupRef.current?.()
      roomCleanupRef.current = null
      await nextRoom.disconnect().catch(() => undefined)
      setRoom(null)
      setRemoteParticipants([])
      setRoomState('failed')
      setJoinError(formatUserFacingError(err instanceof Error ? err.message : '', 'Could not join the LiveKit room.'))
    } finally {
      setJoining(false)
    }
  }

  async function leaveCall() {
    if (!room) return
    roomCleanupRef.current?.()
    roomCleanupRef.current = null
    await room.disconnect()
    setRoom(null)
    setRemoteParticipants([])
    setCameraEnabled(false)
    setMicrophoneEnabled(false)
    setRoomState('disconnected')
  }

  async function toggleCamera() {
    if (!room) return
    try {
      await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled)
      setCameraEnabled(room.localParticipant.isCameraEnabled)
      setJoinError('')
    } catch (err) {
      setJoinError(formatUserFacingError(err instanceof Error ? err.message : '', 'Camera toggle failed.'))
    }
  }

  async function toggleMicrophone() {
    if (!room) return
    try {
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled)
      setMicrophoneEnabled(room.localParticipant.isMicrophoneEnabled)
      setJoinError('')
    } catch (err) {
      setJoinError(formatUserFacingError(err instanceof Error ? err.message : '', 'Microphone toggle failed.'))
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand)] text-white shadow-sm">
              <Video className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Twin Video Call</h1>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (inviteToken) void loadInvite(inviteToken, true)
            }}
            disabled={!inviteToken || loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh invite
          </Button>
        </div>

        {loading ? (
          <Card>
            <p className="text-sm text-[var(--text-muted)]">Loading invite...</p>
          </Card>
        ) : error ? (
          <Card>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </Card>
        ) : session ? (
          <div className="space-y-4">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">Meeting Room</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Meeting with <span className="font-medium text-[var(--text-primary)]">{session.counterpart_name}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span className="rounded-full bg-[var(--bg-muted)] px-2.5 py-1">
                      Participants: {remoteParticipants.length}
                    </span>
                    <span className="rounded-full bg-[var(--bg-muted)] px-2.5 py-1">
                      Mic: {microphoneEnabled ? 'On' : 'Off'}
                    </span>
                    <span className="rounded-full bg-[var(--bg-muted)] px-2.5 py-1">
                      Camera: {cameraEnabled ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={roomStateVariant}>{roomStateLabel}</Badge>
                    <p className="text-sm text-[var(--text-muted)]">
                      Join when you're ready.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {room ? (
                      <>
                        <Button variant="secondary" onClick={() => void toggleMicrophone()}>
                          {microphoneEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                          {microphoneEnabled ? 'Mute mic' : 'Unmute mic'}
                        </Button>
                        <Button variant="secondary" onClick={() => void toggleCamera()}>
                          {cameraEnabled ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                          {cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                        </Button>
                        <Button variant="danger" onClick={() => void leaveCall()}>
                          <PhoneOff className="h-3.5 w-3.5" />
                          Leave call
                        </Button>
                      </>
                    ) : (
                      <Button variant="primary" onClick={() => void joinCall()} disabled={!joinReady} loading={joining}>
                        <Video className="h-3.5 w-3.5" />
                        Join call
                      </Button>
                    )}
                  </div>
                </div>
                {!joinReady && !room ? (
                  <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{joinBlockedReason}</p>
                ) : null}
                {joinError ? (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">{joinError}</p>
                ) : null}
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <MediaTile
                    publication={localVideoPublication ?? localAudioPublication}
                    title="You"
                    emptyLabel="Join the room to start publishing your camera or microphone."
                    mirrored
                  />
                </Card>
                <Card>
                  <MediaTile
                    publication={remoteVideoPublication ?? remoteAudioPublication}
                    audioPublication={remoteAudioPublication}
                    title={remotePrimary?.name || remotePrimary?.identity || session.counterpart_name}
                    emptyLabel="Waiting for the remote avatar or participant media to arrive."
                    debugLabel={remoteDebugLabel}
                  />
                </Card>
              </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
