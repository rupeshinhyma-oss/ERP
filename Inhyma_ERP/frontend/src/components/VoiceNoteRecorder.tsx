import React, { useEffect, useRef, useState } from "react";

interface VoiceNoteRecorderProps {
  onRecordingComplete: (blob: Blob, durationSeconds: number) => void;
  onCancel?: () => void;
  isUploading?: boolean;
}

export const VoiceNoteRecorder: React.FC<VoiceNoteRecorderProps> = ({
  onRecordingComplete,
  onCancel,
  isUploading = false,
}) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      stopStreamsAndTimers();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const stopStreamsAndTimers = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setRecordingTime(0);
    chunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg("Audio recording is not supported in this browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      let mimeType = "audio/webm";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        mimeType = "audio/ogg;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(finalBlob);
        const url = URL.createObjectURL(finalBlob);
        setAudioUrl(url);
        stopStreamsAndTimers();
      };

      mediaRecorder.start(250);
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Microphone access error:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMsg("Microphone permission was denied. Please allow microphone access in your browser settings.");
      } else {
        setErrorMsg(err.message || "Failed to access microphone.");
      }
      stopStreamsAndTimers();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetRecording = () => {
    stopStreamsAndTimers();
    setIsRecording(false);
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setRecordingTime(0);
    setErrorMsg(null);
  };

  const handleConfirm = () => {
    if (audioBlob) {
      onRecordingComplete(audioBlob, recordingTime || 1);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "10px",
        border: isRecording ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--border-color, #e2e8f0)",
        background: isRecording ? "rgba(239, 68, 68, 0.04)" : "var(--bg-card, #f8fafc)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {errorMsg && (
        <div
          style={{
            fontSize: "12px",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {errorMsg}
        </div>
      )}

      {/* Initial state: Not recording & no recorded blob */}
      {!isRecording && !audioBlob && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-muted, #64748b)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <span>Record a voice note</span>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  background: "transparent",
                  border: "1px solid var(--border-color, #cbd5e1)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  color: "var(--text-muted, #64748b)",
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={startRecording}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 600,
                background: "#ef4444",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(239, 68, 68, 0.2)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="4" fill="currentColor" />
              </svg>
              Start Recording
            </button>
          </div>
        </div>
      )}

      {/* Recording in progress */}
      {isRecording && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#ef4444",
                boxShadow: "0 0 0 0 rgba(239, 68, 68, 0.7)",
                animation: "pulse 1.5s infinite",
              }}
            />
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#ef4444", fontVariantNumeric: "tabular-nums" }}>
              {formatTime(recordingTime)}
            </span>

            {/* Sound wave bars */}
            <div style={{ display: "flex", alignItems: "center", gap: "2px", height: "18px", marginLeft: "6px" }}>
              {[0.4, 0.9, 0.6, 1, 0.5, 0.8, 0.3].map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: "3px",
                    height: `${h * 16}px`,
                    background: "#ef4444",
                    borderRadius: "1.5px",
                    opacity: 0.8,
                  }}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={stopRecording}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: 600,
              background: "#1e293b",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            Stop
          </button>
        </div>
      )}

      {/* Completed Recording Preview */}
      {!isRecording && audioBlob && audioUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
            <audio
              src={audioUrl}
              controls
              style={{
                height: "36px",
                flex: 1,
                outline: "none",
                borderRadius: "6px",
              }}
            />
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-muted, #64748b)",
                whiteSpace: "nowrap",
              }}
            >
              {formatTime(recordingTime)}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              onClick={resetRecording}
              disabled={isUploading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 10px",
                fontSize: "12px",
                color: "#ef4444",
                background: "transparent",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "6px",
                cursor: isUploading ? "not-allowed" : "pointer",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              Re-record
            </button>

            {onCancel && (
              <button
                type="button"
                onClick={() => {
                  resetRecording();
                  onCancel();
                }}
                disabled={isUploading}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  background: "transparent",
                  border: "1px solid var(--border-color, #cbd5e1)",
                  borderRadius: "6px",
                  cursor: isUploading ? "not-allowed" : "pointer",
                  color: "var(--text-muted, #64748b)",
                }}
              >
                Cancel
              </button>
            )}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={isUploading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 14px",
                fontSize: "12px",
                fontWeight: 600,
                background: "var(--color-primary, #4f46e5)",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor: isUploading ? "not-allowed" : "pointer",
                opacity: isUploading ? 0.7 : 1,
              }}
            >
              {isUploading ? (
                <span>Uploading...</span>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Attach Audio
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
