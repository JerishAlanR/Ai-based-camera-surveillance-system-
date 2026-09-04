"""
Configuration settings for AI Boundary Surveillance.
Edit values here instead of digging through the other files.
"""

import os

# The log file stays beside this config.py file, regardless of the folder
# from which you start the program.
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
EVENT_LOG_PATH = os.path.join(PROJECT_DIR, "boundary_events.csv")

# --- Camera settings ---
CAMERA_INDEX = 0  # change to 1 or 2 if 0 doesn't work

# --- Detection settings ---
MODEL_PATH = os.path.join(PROJECT_DIR, "yolov8n.pt")
CONFIDENCE_THRESHOLD = 0.4
TARGET_CLASSES = ["person", "car"]

# --- Boundary line settings ---
BOUNDARY_START = (330, 30)
BOUNDARY_END = (330, 300)
BOUNDARY_COLOR = (0, 0, 255)   # red, in BGR format
BOUNDARY_THICKNESS = 5

# --- Crossing alert display settings ---
# How many seconds an on-screen "BOUNDARY CROSSED" message stays visible.
CROSSING_MESSAGE_DURATION = 3.0
CROSSING_TEXT_COLOR = (0, 0, 255)  # red

# --- Local alert settings ---
WARNING_SOUND_FREQUENCY = 1000  # Hz; used by Windows winsound
WARNING_SOUND_DURATION = 250   # milliseconds
WARNING_SOUND_COOLDOWN = 1.0   # avoid repeating the sound continuously
