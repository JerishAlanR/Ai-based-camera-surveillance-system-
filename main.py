"""
AI Boundary Surveillance - Stage 6
Goal: Detect, track, show the boundary, detect crossings, play a local warning,
and save crossing events to a local CSV log.
Press 'q' to quit.
"""

import csv
import os
import time

import cv2
import winsound

from tracker import Tracker
from boundary import draw_boundary, CrossingDetector
import config


def draw_tracks(frame, tracked_objects):
    """Draw a box + label (with tracking ID) for each tracked object."""
    for obj in tracked_objects:
        x1, y1, x2, y2 = obj["box"]
        label = f'ID {obj["track_id"]} | {obj["class_name"]} {obj["confidence"]:.2f}'

        color = (0, 255, 0) if obj["class_name"] == "person" else (255, 128, 0)

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        (text_w, text_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(frame, (x1, y1 - text_h - 8), (x1 + text_w + 4, y1), color, -1)
        cv2.putText(frame, label, (x1 + 2, y1 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

    return frame


def draw_active_messages(frame, active_messages):
    """
    Draw all currently-active 'BOUNDARY CROSSED' messages, stacked
    vertically in the top-left corner of the frame.
    """
    y_offset = 40
    for msg in active_messages:
        cv2.putText(
            frame,
            msg["text"],
            (20, y_offset),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            config.CROSSING_TEXT_COLOR,
            2
        )
        y_offset += 35

    return frame


def play_warning_sound():
    """Play one short warning sound through the Windows computer."""
    try:
        winsound.Beep(
            config.WARNING_SOUND_FREQUENCY,
            config.WARNING_SOUND_DURATION
        )
    except RuntimeError as error:
        # The visual warning and CSV log should still work if the sound device
        # is unavailable or Windows cannot play the beep.
        print(f"WARNING: Could not play warning sound: {error}")


def log_crossing_event(event):
    """Append one crossing event to the local CSV log, creating its header once."""
    file_exists = os.path.exists(config.EVENT_LOG_PATH)
    fieldnames = ["datetime", "object_type", "tracking_id", "crossing_direction"]

    with open(config.EVENT_LOG_PATH, "a", newline="", encoding="utf-8") as log_file:
        writer = csv.DictWriter(log_file, fieldnames=fieldnames)

        if not file_exists or os.path.getsize(config.EVENT_LOG_PATH) == 0:
            writer.writeheader()

        writer.writerow({
            "datetime": time.strftime("%Y-%m-%d %H:%M:%S"),
            "object_type": event["class_name"],
            "tracking_id": event["track_id"],
            "crossing_direction": event["direction"]
        })


def main():
    cap = cv2.VideoCapture(config.CAMERA_INDEX, cv2.CAP_DSHOW)

    if not cap.isOpened():
        print(f"ERROR: Could not open camera index {config.CAMERA_INDEX}.")
        print("Try changing CAMERA_INDEX in config.py, and make sure no other app is using the webcam.")
        return

    ret, sample_frame = cap.read()
    if ret:
        height, width = sample_frame.shape[:2]
        print(f"Camera resolution detected: {width}x{height} pixels")

    tracker = Tracker()
    crossing_detector = CrossingDetector()

    # Messages currently on screen: list of {"text": str, "expires_at": timestamp}
    active_messages = []
    last_sound_time = 0.0

    print("Webcam + tracker + boundary + crossing detection ready.")
    print(f"Crossing events will be logged to: {config.EVENT_LOG_PATH}")
    print("Press 'q' in the video window to quit.")

    while True:
        ret, frame = cap.read()

        if not ret:
            print("ERROR: Failed to read frame from webcam. Exiting.")
            break

        tracked_objects = tracker.track(frame)
        crossing_events = crossing_detector.update(tracked_objects)

        # Turn any new crossing events into on-screen messages, a local sound,
        # and a permanent local CSV record.
        for event in crossing_events:
            text = (
                f'BOUNDARY CROSSED: {event["class_name"]} '
                f'(ID {event["track_id"]}) '
                f'[{event["direction"]}]'
            )
            print(text)
            log_crossing_event(event)
            active_messages.append({
                "text": text,
                "expires_at": time.time() + config.CROSSING_MESSAGE_DURATION
            })

            now = time.time()
            if now - last_sound_time >= config.WARNING_SOUND_COOLDOWN:
                play_warning_sound()
                last_sound_time = now

        # Remove expired messages
        active_messages = [m for m in active_messages if m["expires_at"] > time.time()]

        frame = draw_tracks(frame, tracked_objects)
        frame = draw_boundary(frame)
        frame = draw_active_messages(frame, active_messages)

        cv2.imshow("AI Boundary Surveillance - Stage 5", frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            print("Quit key pressed. Closing.")
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
