import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Headphones,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  PlayCircle,
  RefreshCw,
  Upload,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import type { DiscoveryVideoItem, Language, ProficiencyLevel, SubtitleLine } from '../types';
import { buildJapaneseSpeechText, formatTime, speakNative } from '../lib/youtube';
import { getSimilarVideos } from '../data/discoveryCatalog';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        config: Record<string, unknown>
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  loadVideoById?: (args: { videoId: string; startSeconds?: number } | string, startSeconds?: number) => void;
  cueVideoById?: (args: { videoId: string; startSeconds?: number } | string, startSeconds?: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  getIframe?: () => HTMLIFrameElement;
}

export interface YouTubePlayerHandle {
  seekTo: (seconds: number, autoPlay?: boolean) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  getCurrentTime: () => number;
  isPlaying: () => boolean;
  setPlaybackRate: (rate: number) => void;
}

/**
 * 3-Tier Immortal Self-Healing Architecture:
 * primary (youtube.com JS API)
 *  -> Tier 1: nocookie (youtube-nocookie.com JS API)
 *  -> Tier 2: raw_iframe (pure clean HTML iframe + independent synced subtitle timeline)
 *  -> Tier 3: companion (Seamless Synced Study Player with crisp thumbnail, live scrubber, TTS, external link & local media)
 */
type RecoveryTier = 'primary' | 'nocookie' | 'raw_iframe' | 'companion' | 'deleted';

const STRICT_YT_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

interface YouTubePlayerProps {
  videoId: string | null;
  videoTitle: string;
  language: Language;
  targetLevel: ProficiencyLevel;
  initialStartTime?: number;
  playbackRate: number;
  syncOffsetSec?: number;
  activeLine: SubtitleLine | null;
  allLines: SubtitleLine[];
  loopSingleLine: boolean;
  loopA: number | null;
  loopB: number | null;
  autoPausePerLine: boolean;
  autoPauseDelaySec: number;
  dictationMode: boolean;
  podcastMode: boolean;
  onTogglePodcastMode: () => void;
  onTimeUpdate: (timeSec: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onDurationChange?: (durationSec: number) => void;
  onLineEndPause?: (line: SubtitleLine) => void;
  onSelectReplacementVideo?: (item: DiscoveryVideoItem) => void;
}

let ytApiPromise: Promise<void> | null = null;

/**
 * Singleton Eager Preloader for YouTube IFrame API.
 * Safe to invoke immediately at app boot on Homepage so YT.Player is warm before first link paste.
 */
export function preloadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

const loadYouTubeIframeApi = preloadYouTubeIframeApi;

function hardenYouTubeIframeAttributes(
  container: HTMLElement | null,
  player: YTPlayerInstance | null
) {
  const iframe =
    player?.getIframe?.() ||
    (container?.querySelector('iframe') as HTMLIFrameElement | null);
  if (!iframe) return;
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.setAttribute(
    'allow',
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
  );
  iframe.setAttribute('allowfullscreen', 'true');
  iframe.className = 'w-full h-full border-0';
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  (
    {
      videoId,
      videoTitle,
      language,
      targetLevel,
      initialStartTime = 0,
      playbackRate,
      syncOffsetSec = 0,
      activeLine,
      allLines,
      loopSingleLine,
      loopA,
      loopB,
      autoPausePerLine,
      autoPauseDelaySec,
      dictationMode,
      podcastMode,
      onTogglePodcastMode,
      onTimeUpdate,
      onPlayStateChange,
      onDurationChange,
      onLineEndPause,
      onSelectReplacementVideo,
    },
    ref
  ) => {
    const validVideoId = videoId && STRICT_YT_ID_REGEX.test(videoId) ? videoId : null;

    const slotRef = useRef<HTMLDivElement | null>(null);
    const ytMountRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const localMediaRef = useRef<HTMLVideoElement | null>(null);
    const localFileInputRef = useRef<HTMLInputElement | null>(null);

    const isReadyRef = useRef(false);
    const mountedTierRef = useRef<RecoveryTier | null>(null);
    const loadedVideoIdRef = useRef<string | null>(null);
    const lastPausedLineIdRef = useRef<string | null>(null);
    const resumeTimerRef = useRef<number | null>(null);
    const countdownIntervalRef = useRef<number | null>(null);
    const readyTimeoutRef = useRef<number | null>(null);
    const maskTimerRef = useRef<number | null>(null);
    const lastReportedDurationRef = useRef<number>(0);

    const [tier, setTier] = useState<RecoveryTier>('primary');
    const [lastErrorCode, setLastErrorCode] = useState<number | null>(null);
    const [shadowCountdown, setShadowCountdown] = useState<number | null>(null);
    const [thumbFailed, setThumbFailed] = useState(false);
    // 0ms Zero-Flash Thumbnail Mask while YT player swaps / initializes underneath
    const [showZeroFlashMask, setShowZeroFlashMask] = useState(true);

    // Independent Synced Clock for Tier 2 (raw_iframe) & Tier 3 (companion)
    const [localMediaUrl, setLocalMediaUrl] = useState<string | null>(null);
    const [localMediaName, setLocalMediaName] = useState<string>('');
    const [virtualPlaying, setVirtualPlaying] = useState(false);
    const [virtualTimeDisplay, setVirtualTimeDisplay] = useState<number>(initialStartTime);
    const virtualTimeRef = useRef<number>(initialStartTime);
    const lastSpokenLineIdRef = useRef<string | null>(null);
    const [rawIframeStart, setRawIframeStart] = useState<number>(Math.floor(initialStartTime));

    // Sticky Floating Mini-Player when scrolled out of viewport
    const [isFloating, setIsFloating] = useState(false);
    const [miniDismissed, setMiniDismissed] = useState(false);

    const totalTimelineSec = useMemo(() => {
      if (allLines.length === 0) return 180;
      return Math.max(10, Math.ceil(allLines[allLines.length - 1].end + 2));
    }, [allLines]);

    const propsRef = useRef({
      activeLine,
      allLines,
      language,
      playbackRate,
      syncOffsetSec,
      loopSingleLine,
      loopA,
      loopB,
      autoPausePerLine,
      autoPauseDelaySec,
      dictationMode,
      onTimeUpdate,
      onPlayStateChange,
      onDurationChange,
      onLineEndPause,
    });
    propsRef.current = {
      activeLine,
      allLines,
      language,
      playbackRate,
      syncOffsetSec,
      loopSingleLine,
      loopA,
      loopB,
      autoPausePerLine,
      autoPauseDelaySec,
      dictationMode,
      onTimeUpdate,
      onPlayStateChange,
      onDurationChange,
      onLineEndPause,
    };

    const reportPlayerDuration = (player: YTPlayerInstance | null) => {
      if (!player || typeof player.getDuration !== 'function') return;
      try {
        const dur = Math.round(player.getDuration() || 0);
        if (dur > 5 && Math.abs(dur - lastReportedDurationRef.current) >= 2) {
          lastReportedDurationRef.current = dur;
          propsRef.current.onDurationChange?.(dur);
        }
      } catch {
        // Ignore
      }
    };

    const clearAutoResume = () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      if (countdownIntervalRef.current !== null) {
        window.clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setShadowCountdown(null);
    };

    const destroyCurrentYtPlayer = () => {
      if (readyTimeoutRef.current !== null) {
        window.clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore safe destroy errors
        }
        playerRef.current = null;
      }
      isReadyRef.current = false;
      mountedTierRef.current = null;
      loadedVideoIdRef.current = null;
      if (ytMountRef.current) {
        ytMountRef.current.innerHTML = '';
      }
    };

    const revealPlayerFromMask = () => {
      if (maskTimerRef.current !== null) {
        window.clearTimeout(maskTimerRef.current);
        maskTimerRef.current = null;
      }
      setShowZeroFlashMask(false);
    };

    // Reset recovery tier & show 0ms Zero-Flash Thumbnail Mask ONLY when videoId actually changes
    useEffect(() => {
      clearAutoResume();
      lastPausedLineIdRef.current = null;
      lastSpokenLineIdRef.current = null;
      lastReportedDurationRef.current = 0;
      virtualTimeRef.current = initialStartTime;
      setVirtualTimeDisplay(initialStartTime);
      setRawIframeStart(Math.floor(initialStartTime));
      setVirtualPlaying(false);
      setLastErrorCode(null);
      setMiniDismissed(false);
      setThumbFailed(false);
      if (validVideoId) {
        setShowZeroFlashMask(true);
        if (maskTimerRef.current !== null) window.clearTimeout(maskTimerRef.current);
        // Safety auto-reveal so mask never lingers even if video is cued without autoplay
        maskTimerRef.current = window.setTimeout(() => setShowZeroFlashMask(false), 1100);
      }
      // Keep warm tier if already on 'primary' or 'nocookie'; reset only from terminal/fallback tiers
      setTier((prev) => (prev === 'primary' || prev === 'nocookie' ? prev : 'primary'));
      if (localMediaUrl) {
        URL.revokeObjectURL(localMediaUrl);
        setLocalMediaUrl(null);
        setLocalMediaName('');
      }
    }, [validVideoId]);

    // IntersectionObserver for Sticky Floating Mini-Player
    useEffect(() => {
      const slot = slotRef.current;
      if (!slot || !validVideoId) {
        setIsFloating(false);
        return;
      }
      const obs = new IntersectionObserver(
        ([entry]) => {
          setIsFloating(!entry.isIntersecting);
        },
        { threshold: 0.15 }
      );
      obs.observe(slot);
      return () => obs.disconnect();
    }, [validVideoId]);

    const isVirtualClockTier = tier === 'companion' || tier === 'raw_iframe';

    // Imperative Controls unified across Primary, NoCookie, Raw IFrame, Local Media, and Companion TTS
    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number, autoPlay = true) => {
        clearAutoResume();
        lastPausedLineIdRef.current = null;
        const safeSec = Math.max(0, seconds);

        if (localMediaUrl && localMediaRef.current) {
          localMediaRef.current.currentTime = safeSec;
          if (autoPlay) localMediaRef.current.play().catch(() => {});
          return;
        }
        if (isVirtualClockTier) {
          virtualTimeRef.current = safeSec;
          setVirtualTimeDisplay(safeSec);
          lastSpokenLineIdRef.current = null;
          propsRef.current.onTimeUpdate(safeSec);
          if (tier === 'raw_iframe') {
            setRawIframeStart(Math.floor(safeSec));
          }
          if (autoPlay) {
            setVirtualPlaying(true);
            propsRef.current.onPlayStateChange(true);
          }
          return;
        }
        if (playerRef.current && isReadyRef.current) {
          playerRef.current.seekTo(safeSec, true);
          propsRef.current.onTimeUpdate(
            Math.max(0, Number((safeSec + propsRef.current.syncOffsetSec).toFixed(3)))
          );
          if (autoPlay) playerRef.current.playVideo();
        }
      },
      play: () => {
        clearAutoResume();
        if (localMediaUrl && localMediaRef.current) {
          localMediaRef.current.play().catch(() => {});
          return;
        }
        if (isVirtualClockTier) {
          setVirtualPlaying(true);
          propsRef.current.onPlayStateChange(true);
          return;
        }
        if (playerRef.current && isReadyRef.current) {
          playerRef.current.playVideo();
        }
      },
      pause: () => {
        clearAutoResume();
        if (localMediaUrl && localMediaRef.current) {
          localMediaRef.current.pause();
          return;
        }
        if (isVirtualClockTier) {
          setVirtualPlaying(false);
          window.speechSynthesis?.cancel();
          propsRef.current.onPlayStateChange(false);
          return;
        }
        if (playerRef.current && isReadyRef.current) {
          playerRef.current.pauseVideo();
        }
      },
      togglePlay: () => {
        clearAutoResume();
        if (localMediaUrl && localMediaRef.current) {
          if (localMediaRef.current.paused) localMediaRef.current.play().catch(() => {});
          else localMediaRef.current.pause();
          return;
        }
        if (isVirtualClockTier) {
          setVirtualPlaying((prev) => {
            const next = !prev;
            if (!next) window.speechSynthesis?.cancel();
            propsRef.current.onPlayStateChange(next);
            return next;
          });
          return;
        }
        if (!playerRef.current || !isReadyRef.current) return;
        const st = playerRef.current.getPlayerState();
        if (st === 1) playerRef.current.pauseVideo();
        else playerRef.current.playVideo();
      },
      getCurrentTime: () => {
        if (localMediaUrl && localMediaRef.current) {
          return localMediaRef.current.currentTime || 0;
        }
        if (isVirtualClockTier) return virtualTimeRef.current;
        if (playerRef.current && isReadyRef.current) {
          return playerRef.current.getCurrentTime() || 0;
        }
        return 0;
      },
      isPlaying: () => {
        if (localMediaUrl && localMediaRef.current) {
          return !localMediaRef.current.paused;
        }
        if (isVirtualClockTier) return virtualPlaying;
        if (playerRef.current && isReadyRef.current) {
          return playerRef.current.getPlayerState() === 1;
        }
        return false;
      },
      setPlaybackRate: (rate: number) => {
        if (localMediaRef.current) {
          localMediaRef.current.playbackRate = rate;
        }
        if (playerRef.current && isReadyRef.current) {
          try {
            playerRef.current.setPlaybackRate(rate);
          } catch {
            // Ignore
          }
        }
      },
    }));

    // Warm Player Reuse via loadVideoById() — Avoids destroying/rebuilding <iframe> on video switch!
    // Only rebuilds the YouTube JS API Player when tier changes (error recovery) or no warm instance exists.
    useEffect(() => {
      if (!validVideoId || (tier !== 'primary' && tier !== 'nocookie') || localMediaUrl) {
        destroyCurrentYtPlayer();
        return;
      }

      // FAST PATH: Reuse live warm YT.Player instance via loadVideoById() (3-4x faster switch!)
      if (
        playerRef.current &&
        isReadyRef.current &&
        mountedTierRef.current === tier &&
        typeof playerRef.current.loadVideoById === 'function'
      ) {
        if (loadedVideoIdRef.current !== validVideoId) {
          loadedVideoIdRef.current = validVideoId;
          try {
            playerRef.current.loadVideoById({
              videoId: validVideoId,
              startSeconds: Math.floor(initialStartTime),
            });
            playerRef.current.setPlaybackRate(propsRef.current.playbackRate);
            window.setTimeout(revealPlayerFromMask, 260);
            window.setTimeout(() => reportPlayerDuration(playerRef.current), 450);
            window.setTimeout(() => reportPlayerDuration(playerRef.current), 1500);
            return;
          } catch {
            // Fall through to clean rebuild if live instance threw
          }
        } else {
          revealPlayerFromMask();
          return;
        }
      }

      let cancelled = false;
      destroyCurrentYtPlayer();

      const host =
        tier === 'nocookie'
          ? 'https://www.youtube-nocookie.com'
          : 'https://www.youtube.com';

      loadYouTubeIframeApi().then(() => {
        if (cancelled || !ytMountRef.current || !window.YT) return;

        ytMountRef.current.innerHTML = '';
        const mountNode = document.createElement('div');
        mountNode.className = 'w-full h-full';
        ytMountRef.current.appendChild(mountNode);

        // Safe origin guard: never pass origin: 'null' or non-http(s) origin
        const safeOrigin =
          typeof window !== 'undefined' &&
          /^https?:/i.test(window.location.protocol) &&
          window.location.origin &&
          window.location.origin !== 'null'
            ? window.location.origin
            : undefined;

        const playerVars: Record<string, unknown> = {
          enablejsapi: 1,
          autoplay: 0,
          start: Math.floor(initialStartTime),
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          cc_load_policy: 0,
          widget_referrer:
            typeof window !== 'undefined' && safeOrigin ? window.location.href : undefined,
        };
        if (safeOrigin) {
          playerVars.origin = safeOrigin;
        }

        // 3.5s Watchdog Guard: auto-escalate primary -> nocookie -> raw_iframe
        readyTimeoutRef.current = window.setTimeout(() => {
          if (!isReadyRef.current && !cancelled) {
            if (tier === 'primary') {
              setTier('nocookie');
            } else if (tier === 'nocookie') {
              setTier('raw_iframe');
            }
          }
        }, 3500);

        const instance = new window.YT.Player(mountNode, {
          host,
          videoId: validVideoId,
          width: '100%',
          height: '100%',
          playerVars,
          events: {
            onReady: (ev: { target: YTPlayerInstance }) => {
              if (cancelled) return;
              if (readyTimeoutRef.current !== null) {
                window.clearTimeout(readyTimeoutRef.current);
                readyTimeoutRef.current = null;
              }
              isReadyRef.current = true;
              mountedTierRef.current = tier;
              loadedVideoIdRef.current = validVideoId;
              revealPlayerFromMask();
              hardenYouTubeIframeAttributes(ytMountRef.current, ev.target);
              reportPlayerDuration(ev.target);
              window.setTimeout(() => reportPlayerDuration(ev.target), 1200);
              try {
                ev.target.setPlaybackRate(propsRef.current.playbackRate);
              } catch {
                // Ignore
              }
            },
            onStateChange: (ev: { data: number }) => {
              const isNowPlaying = ev.data === 1;
              if (ev.data === 1 || ev.data === 2 || ev.data === 3 || ev.data === 5 || ev.data === 0) {
                revealPlayerFromMask();
                reportPlayerDuration(playerRef.current);
                // Zero-Drift State Snapping: immediately lock clock to real audio currentTime on PLAY/PAUSE/BUFFER/END
                try {
                  const snapRaw = playerRef.current?.getCurrentTime();
                  if (typeof snapRaw === 'number' && Number.isFinite(snapRaw) && snapRaw >= 0) {
                    const snapped = Math.max(
                      0,
                      Number((snapRaw + propsRef.current.syncOffsetSec).toFixed(3))
                    );
                    propsRef.current.onTimeUpdate(snapped);
                  }
                } catch {
                  // Ignore
                }
              }
              propsRef.current.onPlayStateChange(isNowPlaying);
              if (isNowPlaying) clearAutoResume();
            },
            onPlaybackRateChange: () => {
              // Zero-Drift State Snapping on speed change (0.5x - 2.0x)
              try {
                const snapRaw = playerRef.current?.getCurrentTime();
                if (typeof snapRaw === 'number' && Number.isFinite(snapRaw) && snapRaw >= 0) {
                  propsRef.current.onTimeUpdate(
                    Math.max(0, Number((snapRaw + propsRef.current.syncOffsetSec).toFixed(3)))
                  );
                }
              } catch {
                // Ignore
              }
            },
            onError: (ev: { data: number }) => {
              if (cancelled) return;
              const code = ev.data;
              setLastErrorCode(code);
              revealPlayerFromMask();

              // Video removed or set to Private (Error 100)
              if (code === 100) {
                setTier('deleted');
                return;
              }

              // Embed restriction / origin error (101, 150, 153, 2, 5) -> Self-Healing Cascade
              if (code === 101 || code === 150 || code === 153 || code === 2 || code === 5) {
                if (tier === 'primary') {
                  setTier('nocookie');
                } else if (tier === 'nocookie') {
                  if (code === 101 || code === 150) {
                    setTier('companion');
                  } else {
                    setTier('raw_iframe');
                  }
                } else {
                  setTier('companion');
                }
              }
            },
          },
        });

        playerRef.current = instance;
        mountedTierRef.current = tier;
        loadedVideoIdRef.current = validVideoId;
        window.setTimeout(() => hardenYouTubeIframeAttributes(ytMountRef.current, instance), 50);
      });

      return () => {
        cancelled = true;
      };
    }, [validVideoId, tier, localMediaUrl]);

    // Destroy player cleanly ONLY when YouTubePlayer component unmounts
    useEffect(() => {
      return () => {
        if (maskTimerRef.current !== null) window.clearTimeout(maskTimerRef.current);
        destroyCurrentYtPlayer();
      };
    }, []);

    // Sync playback rate changes
    useEffect(() => {
      if (localMediaRef.current) {
        localMediaRef.current.playbackRate = playbackRate;
      }
      if (playerRef.current && isReadyRef.current) {
        try {
          playerRef.current.setPlaybackRate(playbackRate);
        } catch {
          // Ignore
        }
      }
    }, [playbackRate]);

    // Ground-Truth 60FPS requestAnimationFrame (rAF) Sync Clock, Loop, Auto-Pause & Virtual TTS Engine
    // Reads player.getCurrentTime() directly on every frame while playing -> <50ms drift across 0.5x-1.5x!
    useEffect(() => {
      if (!validVideoId) return;

      let rafId = 0;
      let prevFrameTs = performance.now();
      let lastReportedTime = -999;
      let lastPausedPollTs = 0;
      let lastVirtualDisplayTs = 0;

      const tick = (frameTs: number) => {
        const dtSec = Math.min(0.25, Math.max(0, (frameTs - prevFrameTs) / 1000));
        prevFrameTs = frameTs;

        const {
          activeLine: line,
          allLines: linesList,
          language: lang,
          playbackRate: rate,
          syncOffsetSec: syncOffset,
          loopSingleLine: loopLine,
          loopA: a,
          loopB: b,
          autoPausePerLine: autoPause,
          autoPauseDelaySec: pauseDelay,
          dictationMode: isDictation,
          onTimeUpdate: reportTime,
          onLineEndPause: notifyLinePause,
        } = propsRef.current;

        let rawNow = -1;
        let playing = false;
        let seekAction: (t: number) => void = () => {};
        let pauseAction: () => void = () => {};
        let playAction: () => void = () => {};

        if (localMediaUrl && localMediaRef.current) {
          const el = localMediaRef.current;
          rawNow = el.currentTime || 0;
          playing = !el.paused && !el.ended;
          seekAction = (t) => {
            el.currentTime = Math.max(0, t);
            el.play().catch(() => {});
          };
          pauseAction = () => el.pause();
          playAction = () => el.play().catch(() => {});
        } else if (isVirtualClockTier) {
          if (virtualPlaying) {
            virtualTimeRef.current = Number((virtualTimeRef.current + dtSec * rate).toFixed(3));
            const maxEnd = linesList.length > 0 ? linesList[linesList.length - 1].end + 1 : 600;
            if (virtualTimeRef.current > maxEnd) {
              setVirtualPlaying(false);
              propsRef.current.onPlayStateChange(false);
            }
            if (frameTs - lastVirtualDisplayTs >= 120) {
              lastVirtualDisplayTs = frameTs;
              setVirtualTimeDisplay(virtualTimeRef.current);
            }
          }
          rawNow = virtualTimeRef.current;
          playing = virtualPlaying;
          seekAction = (t) => {
            const safeT = Math.max(0, t);
            virtualTimeRef.current = safeT;
            setVirtualTimeDisplay(safeT);
            lastSpokenLineIdRef.current = null;
          };
          pauseAction = () => {
            setVirtualPlaying(false);
            window.speechSynthesis?.cancel();
            propsRef.current.onPlayStateChange(false);
          };
          playAction = () => {
            setVirtualPlaying(true);
            propsRef.current.onPlayStateChange(true);
          };

          // Auto-speak active subtitle line in Tier 3 Companion Mode (with Japanese Furigana parity)
          const effectiveVirtual = Math.max(0, rawNow + syncOffset);
          if (
            tier === 'companion' &&
            playing &&
            line &&
            lastSpokenLineIdRef.current !== line.id &&
            effectiveVirtual >= line.start
          ) {
            lastSpokenLineIdRef.current = line.id;
            const spoken = lang === 'ja' ? buildJapaneseSpeechText(line) : line.text;
            speakNative(spoken, lang, rate);
          }
        } else if (playerRef.current && isReadyRef.current) {
          try {
            const state = playerRef.current.getPlayerState();
            playing = state === 1;
            // Poll every frame when playing; when paused/buffering/cued, poll every ~120ms so manual scrubbing updates instantly
            if (playing || frameTs - lastPausedPollTs >= 120) {
              lastPausedPollTs = frameTs;
              rawNow = playerRef.current.getCurrentTime() || 0;
              if (lastReportedDurationRef.current === 0) {
                reportPlayerDuration(playerRef.current);
              }
              seekAction = (t) => playerRef.current?.seekTo(Math.max(0, t), true);
              pauseAction = () => playerRef.current?.pauseVideo();
              playAction = () => playerRef.current?.playVideo();
            }
          } catch {
            rawNow = -1;
          }
        }

        if (rawNow >= 0) {
          const effectiveNow = Math.max(0, Number((rawNow + syncOffset).toFixed(3)));
          // Sub-20ms 60Hz Frame-Accurate Clock: emit immediately when time moves >= 16ms
          if (Math.abs(effectiveNow - lastReportedTime) >= 0.016) {
            lastReportedTime = effectiveNow;
            reportTime(effectiveNow);
          }

          if (playing) {
            // 1. Custom A-B Loop
            if (a !== null && b !== null && b > a + 0.25 && effectiveNow >= b) {
              seekAction(Math.max(0, a - syncOffset));
            } else if (loopLine && line && effectiveNow >= line.end - 0.02) {
              // 2. Exact Single-Line Repeat: jumps cleanly to exact cue.start and stops/loops at cue.end
              seekAction(Math.max(0, Number((line.start - syncOffset).toFixed(3))));
            } else if (
              isDictation &&
              line &&
              effectiveNow >= line.end - 0.05 &&
              lastPausedLineIdRef.current !== line.id
            ) {
              // 3. Dictation Pause
              lastPausedLineIdRef.current = line.id;
              pauseAction();
              notifyLinePause?.(line);
            } else if (
              autoPause &&
              !loopLine &&
              !isDictation &&
              line &&
              effectiveNow >= line.end - 0.05 &&
              lastPausedLineIdRef.current !== line.id
            ) {
              // 4. Shadowing Auto-Pause per Line (3-5s countdown)
              lastPausedLineIdRef.current = line.id;
              pauseAction();
              clearAutoResume();

              const delaySec = Math.max(2, Math.min(8, pauseDelay));
              let remaining = delaySec;
              setShadowCountdown(remaining);

              countdownIntervalRef.current = window.setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                  if (countdownIntervalRef.current !== null) {
                    window.clearInterval(countdownIntervalRef.current);
                    countdownIntervalRef.current = null;
                  }
                  setShadowCountdown(null);
                } else {
                  setShadowCountdown(remaining);
                }
              }, 1000);

              resumeTimerRef.current = window.setTimeout(() => {
                setShadowCountdown(null);
                playAction();
              }, delaySec * 1000);
            }
          }
        }

        rafId = window.requestAnimationFrame(tick);
      };

      rafId = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(rafId);
    }, [validVideoId, tier, localMediaUrl, virtualPlaying, isVirtualClockTier]);

    const handleLocalFileDrop = (file: File | undefined) => {
      if (!file) return;
      if (localMediaUrl) URL.revokeObjectURL(localMediaUrl);
      const url = URL.createObjectURL(file);
      setLocalMediaUrl(url);
      setLocalMediaName(file.name);
      setTier('companion');
    };

    const handleManualScrub = (nextSec: number) => {
      virtualTimeRef.current = nextSec;
      setVirtualTimeDisplay(nextSec);
      lastSpokenLineIdRef.current = null;
      onTimeUpdate(nextSec);
    };

    const replacementSuggestions =
      tier === 'deleted'
        ? getSimilarVideos(language, targetLevel, validVideoId ? [validVideoId] : [], undefined, 3)
        : [];

    if (!validVideoId) {
      return (
        <div className="w-full aspect-video rounded-xl bg-slate-900/95 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center px-6">
          <PlayCircle className="w-12 h-12 text-indigo-400/80 mb-3" strokeWidth={1.5} />
          <p className="text-base font-semibold text-slate-100">
            Dán đường link YouTube bất kỳ (kể cả video 100% Tiếng Việt) để bắt đầu học
          </p>
          <p className="text-xs text-slate-400 mt-1.5 max-w-lg">
            Động cơ tự chữa lành 3 tầng đảm bảo phát mượt không gián đoạn, đồng bộ 60FPS từng câu với phụ đề Anh · Nhật tương tác.
          </p>
        </div>
      );
    }

    const showFloatingMini = isFloating && !miniDismissed && !podcastMode && tier !== 'deleted';
    const thumbUrl = `https://i.ytimg.com/vi/${validVideoId}/hqdefault.jpg`;

    return (
      <div ref={slotRef} className="w-full min-w-0 max-w-full">
        {/* Audio-Only Podcast Focus Bar (keeps YT iframe alive off-screen so audio continues) */}
        {podcastMode && tier !== 'deleted' && (
          <div className="w-full rounded-xl zen-surface border p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                  <Headphones className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    Chế độ Podcast Nghe Thuần (Tắt màn hình video)
                  </div>
                  <div className="text-sm font-bold truncate">{videoTitle}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onTogglePodcastMode}
                className="h-8 px-3 text-xs font-semibold rounded-lg zen-surface-subtle border flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0"
              >
                <Video className="w-3.5 h-3.5" />
                <span>Mở lại hình ảnh</span>
              </button>
            </div>
            {activeLine && (
              <div className="p-4 rounded-lg zen-surface-subtle border text-center space-y-1.5">
                <div className="text-[11px] font-mono-tabular opacity-60">
                  {formatTime(activeLine.start)} – {formatTime(activeLine.end)}
                </div>
                <p
                  className={`text-lg md:text-xl font-semibold leading-relaxed ${
                    language === 'ja' ? 'font-jp' : ''
                  }`}
                >
                  {activeLine.text}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Placeholder footprint while Mini-Player is floating */}
        {showFloatingMini && (
          <div className="w-full aspect-video rounded-xl zen-surface-subtle border border-dashed flex flex-col items-center justify-center gap-2 text-xs opacity-70">
            <span>Video đang phát ở khung nổi góc dưới bên phải</span>
            <button
              type="button"
              onClick={() => slotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              Cuộn về trình phát chính
            </button>
          </div>
        )}

        {/* Primary OR Floating Mini-Player Container */}
        <div
          className={
            podcastMode
              ? 'sr-only'
              : showFloatingMini
                ? 'fixed bottom-4 right-4 z-40 w-[300px] sm:w-[360px] rounded-xl overflow-hidden shadow-2xl border border-slate-700 bg-black'
                : 'relative w-full aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-xs'
          }
        >
          {/* Floating Mini-Player Header Bar */}
          {showFloatingMini && (
            <div className="px-2.5 py-1.5 bg-slate-900/95 text-slate-100 flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-medium">{videoTitle}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    slotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                  title="Quay lại khung chính"
                  className="p-1 hover:bg-slate-800 rounded cursor-pointer"
                >
                  <Maximize2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setMiniDismissed(true)}
                  title="Thu gọn khung nổi"
                  className="p-1 hover:bg-slate-800 rounded cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Deleted / Private Video Recovery (Error 100) */}
          {tier === 'deleted' && (
            <div className="w-full h-full bg-slate-950 text-slate-100 p-5 flex flex-col justify-center space-y-4 overflow-y-auto">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold">
                    Video này đã bị gỡ hoặc chuyển sang Riêng tư trên YouTube
                  </h3>
                  <p className="text-xs text-slate-400">
                    Chọn nhanh 1 trong 3 video đã kiểm chứng phát mượt 100% bên dưới hoặc chuyển sang Chế độ Học Đồng Bộ:
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {replacementSuggestions.map((item) => (
                  <button
                    key={item.videoId}
                    type="button"
                    onClick={() => onSelectReplacementVideo?.(item)}
                    className="text-left p-2.5 rounded-lg bg-slate-900 hover:bg-indigo-950/70 border border-slate-800 hover:border-indigo-500 transition-colors space-y-1 cursor-pointer"
                  >
                    <div className="text-[10px] font-semibold text-indigo-300">
                      {item.level} · {item.durationLabel}
                    </div>
                    <div className="text-xs font-semibold text-white line-clamp-2">
                      {item.title}
                    </div>
                  </button>
                ))}
              </div>
              {allLines.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setTier('companion')}
                    className="h-8 px-3 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white cursor-pointer"
                  >
                    Vẫn học tiếp phụ đề đã trích xuất (TTS Đồng Bộ)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TIER 3: Seamless Synced Study Player (Crisp Thumbnail + Scrubber + TTS + External Link + Local File) */}
          {tier === 'companion' && !localMediaUrl && (
            <div className="relative w-full h-full flex flex-col justify-between bg-slate-950 text-slate-100 overflow-hidden">
              {/* Background Thumbnail with graceful CSS gradient fallback */}
              {!thumbFailed ? (
                <img
                  src={thumbUrl}
                  alt={videoTitle}
                  onError={() => setThumbFailed(true)}
                  className="absolute inset-0 w-full h-full object-cover opacity-35"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/75 to-slate-950/50" />

              {/* Top Companion Info */}
              <div className="relative z-10 p-3.5 sm:p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-teal-300">
                    Chế Độ Học Đồng Bộ Toàn Diện {lastErrorCode ? `· Chống chặn nhúng (${lastErrorCode})` : ''}
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-white truncate mt-0.5">
                    {videoTitle}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setTier('nocookie')}
                  title="Thử nạp lại khung YouTube nhúng"
                  className="h-7 px-2.5 text-[11px] font-medium rounded-md bg-white/10 hover:bg-white/20 text-slate-100 flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Thử lại nhúng</span>
                </button>
              </div>

              {/* Center Active Bilingual Line Preview + Actions */}
              <div className="relative z-10 px-4 text-center space-y-3">
                {activeLine ? (
                  <div className="max-w-xl mx-auto">
                    <p
                      className={`text-base sm:text-lg font-bold text-white leading-snug line-clamp-2 ${
                        language === 'ja' ? 'font-jp' : ''
                      }`}
                    >
                      {activeLine.text}
                    </p>
                    {activeLine.translationVi && (
                      <p className="text-xs text-slate-300 mt-1 line-clamp-1">
                        {activeLine.translationVi}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-300 max-w-md mx-auto">
                    Chủ kênh hạn chế nhúng ngoài YouTube — bạn vẫn học trọn vẹn 100% với giọng đọc chuẩn bản xứ đồng bộ từng câu, mở YouTube song song hoặc nạp file từ máy.
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !virtualPlaying;
                      setVirtualPlaying(next);
                      if (!next) window.speechSynthesis?.cancel();
                      onPlayStateChange(next);
                    }}
                    className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    {virtualPlaying ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>{virtualPlaying ? 'Tạm dừng' : 'Phát đồng bộ TTS'}</span>
                  </button>

                  {activeLine && (
                    <button
                      type="button"
                      onClick={() =>
                        speakNative(
                          language === 'ja' ? buildJapaneseSpeechText(activeLine) : activeLine.text,
                          language,
                          playbackRate
                        )
                      }
                      className="h-9 px-3 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Đọc câu này</span>
                    </button>
                  )}

                  <a
                    href={`https://www.youtube.com/watch?v=${validVideoId}&t=${Math.floor(virtualTimeRef.current)}s`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-9 px-3 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 text-slate-100 flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Mở video gốc song song</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => localFileInputRef.current?.click()}
                    className="h-9 px-3 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Nạp Video/Audio từ máy</span>
                  </button>
                  <input
                    ref={localFileInputRef}
                    type="file"
                    accept="video/*,audio/*"
                    onChange={(e) => handleLocalFileDrop(e.target.files?.[0])}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Bottom Interactive Timeline Scrubber */}
              <div className="relative z-10 px-4 pb-3 pt-2 flex items-center gap-2.5 text-[11px] font-mono-tabular text-slate-300">
                <span className="shrink-0">{formatTime(virtualTimeDisplay)}</span>
                <input
                  type="range"
                  min={0}
                  max={totalTimelineSec}
                  step={0.5}
                  value={Math.min(totalTimelineSec, virtualTimeDisplay)}
                  onChange={(e) => handleManualScrub(Number(e.target.value))}
                  aria-label="Thanh thời gian bài học đồng bộ"
                  className="flex-1 accent-indigo-500 cursor-pointer h-1.5"
                />
                <span className="shrink-0">{formatTime(totalTimelineSec)}</span>
              </div>
            </div>
          )}

          {/* Local Video/Audio Element */}
          {localMediaUrl && (
            <div className="relative w-full aspect-video bg-black">
              <video
                ref={localMediaRef}
                src={localMediaUrl}
                controls
                playsInline
                onPlay={() => onPlayStateChange(true)}
                onPause={() => onPlayStateChange(false)}
                className="w-full h-full object-contain"
              />
              <div className="absolute top-2 left-2 px-2.5 py-1 rounded-md bg-black/75 text-[11px] text-slate-200">
                Đang đồng bộ file cục bộ: {localMediaName}
              </div>
            </div>
          )}

          {/* TIER 2: Pure Clean HTML IFrame (no JS API dependency) */}
          {tier === 'raw_iframe' && !localMediaUrl && (
            <div className="relative w-full h-full">
              <iframe
                key={`${validVideoId}_${rawIframeStart}`}
                src={`https://www.youtube-nocookie.com/embed/${validVideoId}?start=${rawIframeStart}&rel=0&modestbranding=1&playsinline=1`}
                title={videoTitle || 'YouTube Video'}
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          )}

          {/* Primary & TIER 1 (NoCookie) YouTube JS API IFrame Mount + 0ms Zero-Flash Thumbnail Mask */}
          {(tier === 'primary' || tier === 'nocookie') && !localMediaUrl && (
            <div className={showFloatingMini ? 'w-full aspect-video relative' : 'w-full h-full relative'}>
              <div ref={ytMountRef} className="w-full h-full" />
              {/* 0ms Zero-Flash Cover Mask while player warms or swaps videoId underneath */}
              <div
                aria-hidden="true"
                className={`absolute inset-0 pointer-events-none transition-opacity duration-200 bg-slate-950 ${
                  showZeroFlashMask ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {!thumbFailed && (
                  <img
                    src={thumbUrl}
                    alt=""
                    decoding="async"
                    fetchPriority="high"
                    onError={() => setThumbFailed(true)}
                    className="w-full h-full object-cover opacity-85"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-slate-950/30 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-slate-950/70 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white shadow-lg">
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shadowing Auto-Pause Countdown Badge */}
          {shadowCountdown !== null && (
            <div className="absolute bottom-4 right-4 z-20 px-3.5 py-2 rounded-lg bg-slate-950/85 backdrop-blur-md text-white text-xs font-medium flex items-center gap-2 border border-white/15">
              <span>Nhại lại theo người bản xứ</span>
              <span className="font-mono-tabular font-semibold text-teal-300">
                {shadowCountdown}s
              </span>
            </div>
          )}

          {/* Subtle Quick Switch Controls (Podcast + Fallback trigger if embed restricted) */}
          {!showFloatingMini && tier !== 'deleted' && tier !== 'companion' && (
            <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTier('companion')}
                title="Nếu khung video không hiển thị, chuyển sang Chế độ Học Đồng Bộ tức thì"
                className="h-7 px-2.5 rounded-md bg-slate-950/70 hover:bg-slate-950/90 backdrop-blur-sm text-white text-[11px] font-medium flex items-center gap-1 border border-white/10 transition-colors cursor-pointer"
              >
                <Headphones className="w-3 h-3" />
                <span className="hidden sm:inline">Học đồng bộ</span>
              </button>
              <button
                type="button"
                onClick={onTogglePodcastMode}
                title="Chế độ Podcast tắt hình ảnh (Audio-Only)"
                className="h-7 px-2.5 rounded-md bg-slate-950/70 hover:bg-slate-950/90 backdrop-blur-sm text-white text-[11px] font-medium flex items-center gap-1 border border-white/10 transition-colors cursor-pointer"
              >
                <Minimize2 className="w-3 h-3" />
                <span>Podcast</span>
              </button>
            </div>
          )}
        </div>

        {/* Tier 2 Raw IFrame Independent Synchronized Scrubber Bar underneath */}
        {tier === 'raw_iframe' && !localMediaUrl && !podcastMode && (
          <div className="mt-2 px-3 py-2 rounded-xl zen-surface border flex flex-wrap items-center gap-2.5 text-xs">
            <button
              type="button"
              onClick={() => {
                const next = !virtualPlaying;
                setVirtualPlaying(next);
                onPlayStateChange(next);
              }}
              className="h-7 px-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
            >
              {virtualPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{virtualPlaying ? 'Dừng phụ đề' : 'Chạy phụ đề'}</span>
            </button>
            <span className="font-mono-tabular text-[11px] opacity-70 shrink-0">
              {formatTime(virtualTimeDisplay)}
            </span>
            <input
              type="range"
              min={0}
              max={totalTimelineSec}
              step={0.5}
              value={Math.min(totalTimelineSec, virtualTimeDisplay)}
              onChange={(e) => handleManualScrub(Number(e.target.value))}
              aria-label="Đồng bộ phụ đề theo mốc thời gian"
              className="flex-1 min-w-[120px] accent-indigo-600 cursor-pointer h-1.5"
            />
            <span className="font-mono-tabular text-[11px] opacity-70 shrink-0">
              {formatTime(totalTimelineSec)}
            </span>
            <button
              type="button"
              onClick={() => setTier('companion')}
              className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Bật TTS đồng bộ
            </button>
          </div>
        )}
      </div>
    );
  }
);

YouTubePlayer.displayName = 'YouTubePlayer';
