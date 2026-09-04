"""
AI Boundary Surveillance - Stage 7

A beginner-friendly desktop interface for the working surveillance system.
This file reuses the tested Stage 6 detection, tracking, boundary, sound,
and CSV logging code without replacing main.py.

Run with:
    .\\venv\\Scripts\\python.exe .\\app.py
"""

import threading
import time
import tkinter as tk
from tkinter import ttk

import cv2
from PIL import Image, ImageTk

import config
from boundary import CrossingDetector, draw_boundary
from main import draw_active_messages, draw_tracks, log_crossing_event, play_warning_sound
from tracker import Tracker


class SurveillanceApp:
    def __init__(self, root):
        self.root = root
        self.root.title("AI Boundary Surveillance")
        self.root.geometry("1200x760")
        self.root.minsize(950, 620)
        self.root.configure(bg="#202124")

        self.cap = None
        self.tracker = None
        self.crossing_detector = None
        self.active_messages = []
        self.last_sound_time = 0.0
        self.running = False
        self.loading = True
        self.latest_frame = None

        self.status_var = tk.StringVar(value="Loading AI model...")
        self.camera_var = tk.StringVar(value="Camera: starting...")
        self.people_var = tk.StringVar(value="People: 0")
        self.cars_var = tk.StringVar(value="Cars: 0")
        self.objects_var = tk.StringVar(value="Objects: 0")
        self.last_event_var = tk.StringVar(value="Latest crossing: none")
        self.log_var = tk.StringVar(value=f"Log: {config.EVENT_LOG_PATH}")

        self.build_interface()
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        # Load the model in the background so the window appears immediately.
        threading.Thread(target=self.load_system, daemon=True).start()
        self.root.after(100, self.check_loading)

    def build_interface(self):
        header = tk.Frame(self.root, bg="#202124", padx=18, pady=12)
        header.pack(fill="x")

        title = tk.Label(
            header,
            text="AI Boundary Surveillance",
            font=("Segoe UI", 22, "bold"),
            fg="#ffffff",
            bg="#202124"
        )
        title.pack(side="left")

        status = tk.Label(
            header,
            textvariable=self.status_var,
            font=("Segoe UI", 11),
            fg="#8ab4f8",
            bg="#202124"
        )
        status.pack(side="right", padx=10)

        body = tk.Frame(self.root, bg="#202124", padx=18, pady=6)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=4)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        video_frame = tk.Frame(body, bg="#111111", bd=2, relief="sunken")
        video_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        video_frame.rowconfigure(0, weight=1)
        video_frame.columnconfigure(0, weight=1)

        self.video_label = tk.Label(
            video_frame,
            text="The camera preview will appear here.",
            font=("Segoe UI", 14),
            fg="#b8c1cc",
            bg="#111111"
        )
        self.video_label.grid(row=0, column=0, sticky="nsew")

        panel = tk.Frame(body, bg="#2d2f33", padx=16, pady=16)
        panel.grid(row=0, column=1, sticky="nsew")

        tk.Label(
            panel, text="SYSTEM STATUS", font=("Segoe UI", 10, "bold"),
            fg="#9aa0a6", bg="#2d2f33"
        ).pack(anchor="w")
        tk.Label(
            panel, textvariable=self.camera_var, font=("Segoe UI", 11),
            fg="#ffffff", bg="#2d2f33", wraplength=240, justify="left"
        ).pack(anchor="w", pady=(5, 18))

        tk.Label(
            panel, text="LIVE COUNTS", font=("Segoe UI", 10, "bold"),
            fg="#9aa0a6", bg="#2d2f33"
        ).pack(anchor="w")
        for variable in (self.people_var, self.cars_var, self.objects_var):
            tk.Label(
                panel, textvariable=variable, font=("Segoe UI", 15, "bold"),
                fg="#ffffff", bg="#2d2f33"
            ).pack(anchor="w", pady=3)

        tk.Label(
            panel, text="LATEST EVENT", font=("Segoe UI", 10, "bold"),
            fg="#9aa0a6", bg="#2d2f33"
        ).pack(anchor="w", pady=(22, 4))
        tk.Label(
            panel, textvariable=self.last_event_var, font=("Segoe UI", 11),
            fg="#ff8a80", bg="#2d2f33", wraplength=240, justify="left"
        ).pack(anchor="w")

        tk.Label(
            panel, text="EVENT LOG", font=("Segoe UI", 10, "bold"),
            fg="#9aa0a6", bg="#2d2f33"
        ).pack(anchor="w", pady=(22, 4))
        tk.Label(
            panel, textvariable=self.log_var, font=("Segoe UI", 9),
            fg="#d0d7de", bg="#2d2f33", wraplength=240, justify="left"
        ).pack(anchor="w")

        self.start_button = ttk.Button(panel, text="Start camera", command=self.start_camera)
        self.start_button.pack(fill="x", pady=(28, 6))
        self.start_button.configure(state="disabled")

        self.stop_button = ttk.Button(panel, text="Stop camera", command=self.stop_camera)
        self.stop_button.pack(fill="x")
        self.stop_button.configure(state="disabled")

        instructions = tk.Label(
            self.root,
            text="Press Q in the camera window is not required here. Use Stop camera or close this window.\n"
                 "The red line is configured in config.py. Crossing events are saved locally.",
            font=("Segoe UI", 10),
            fg="#c4c7c5",
            bg="#202124",
            justify="left",
            padx=18,
            pady=10
        )
        instructions.pack(fill="x")

    def load_system(self):
        try:
            tracker = Tracker()
            detector = CrossingDetector()
            self.tracker = tracker
            self.crossing_detector = detector
            self.loading = False
        except Exception as error:
            self.loading = False
            self.status_var.set(f"Model error: {error}")

    def check_loading(self):
        if self.tracker is not None and self.loading is False:
            self.status_var.set("Ready")
            self.camera_var.set("Camera: not started")
            self.start_button.configure(state="normal")
            self.start_camera()
            return

        if self.loading:
            self.root.after(100, self.check_loading)
        else:
            self.start_button.configure(state="normal")

    def start_camera(self):
        if self.running or self.tracker is None:
            return

        self.cap = cv2.VideoCapture(config.CAMERA_INDEX, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.status_var.set("Camera error: could not open camera")
            self.camera_var.set(
                f"Camera {config.CAMERA_INDEX} could not be opened. "
                "Try another CAMERA_INDEX in config.py."
            )
            self.cap.release()
            self.cap = None
            return

        self.running = True
        self.status_var.set("Running")
        self.camera_var.set(f"Camera: index {config.CAMERA_INDEX} connected")
        self.start_button.configure(state="disabled")
        self.stop_button.configure(state="normal")
        self.update_frame()

    def stop_camera(self):
        self.running = False
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        self.status_var.set("Stopped")
        self.camera_var.set("Camera: stopped")
        self.start_button.configure(state="normal")
        self.stop_button.configure(state="disabled")

    def update_frame(self):
        if not self.running or self.cap is None:
            return

        ret, frame = self.cap.read()
        if not ret:
            self.status_var.set("Camera error: frame unavailable")
            self.stop_camera()
            return

        tracked_objects = self.tracker.track(frame)
        crossing_events = self.crossing_detector.update(tracked_objects)

        for event in crossing_events:
            event_time = time.strftime("%Y-%m-%d %H:%M:%S")
            event_text = (
                f"{event_time}\n"
                f"{event['class_name']} ID {event['track_id']}\n"
                f"{event['direction']}"
            )
            self.last_event_var.set(f"Latest crossing:\n{event_text}")
            log_crossing_event(event)
            self.active_messages.append({
                "text": f"BOUNDARY CROSSED: {event['class_name']} ID {event['track_id']}",
                "expires_at": time.time() + config.CROSSING_MESSAGE_DURATION
            })

            now = time.time()
            if now - self.last_sound_time >= config.WARNING_SOUND_COOLDOWN:
                play_warning_sound()
                self.last_sound_time = now

        self.active_messages = [
            message for message in self.active_messages
            if message["expires_at"] > time.time()
        ]

        person_count = sum(obj["class_name"] == "person" for obj in tracked_objects)
        car_count = sum(obj["class_name"] == "car" for obj in tracked_objects)
        self.people_var.set(f"People: {person_count}")
        self.cars_var.set(f"Cars: {car_count}")
        self.objects_var.set(f"Objects: {len(tracked_objects)}")

        frame = draw_tracks(frame, tracked_objects)
        frame = draw_boundary(frame)
        frame = draw_active_messages(frame, self.active_messages)

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(frame_rgb)

        available_width = max(self.video_label.winfo_width(), 640)
        available_height = max(self.video_label.winfo_height(), 420)
        image.thumbnail((available_width - 10, available_height - 10), Image.Resampling.LANCZOS)

        photo = ImageTk.PhotoImage(image=image)
        self.video_label.configure(image=photo, text="")
        self.video_label.image = photo

        self.root.after(15, self.update_frame)

    def close(self):
        self.stop_camera()
        self.root.destroy()


def main():
    root = tk.Tk()
    app = SurveillanceApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
