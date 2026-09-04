"""
Object detection + tracking using YOLOv8's built-in tracker.
Responsible for: loading the model, running detection+tracking on a frame,
and returning a clean list of tracked objects (each with a persistent ID).
"""

from ultralytics import YOLO
import config


class Tracker:
    def __init__(self):
        print(f"Loading detection model: {config.MODEL_PATH} ...")
        self.model = YOLO(config.MODEL_PATH)
        print("Model loaded.")

        # Build a quick lookup of class name -> class id from the model,
        # so we only keep detections for classes we care about (person, car).
        self.target_class_ids = set()
        for class_id, class_name in self.model.names.items():
            if class_name in config.TARGET_CLASSES:
                self.target_class_ids.add(class_id)

    def track(self, frame):
        """
        Run detection + tracking on a single frame.
        Returns a list of dicts, one per tracked object:
            {
                "track_id": 4,
                "class_name": "person",
                "confidence": 0.87,
                "box": (x1, y1, x2, y2)   # pixel coordinates, top-left and bottom-right
            }
        """
        # persist=True tells the tracker to remember object identities
        # from one call to the next (i.e. across frames).
        results = self.model.track(
            frame,
            verbose=False,
            conf=config.CONFIDENCE_THRESHOLD,
            persist=True
        )

        tracked_objects = []

        boxes = results[0].boxes

        # If nothing is detected/tracked yet, boxes.id can be None - guard against that.
        if boxes is None or boxes.id is None:
            return tracked_objects

        for box in boxes:
            class_id = int(box.cls[0])

            if class_id not in self.target_class_ids:
                continue  # skip classes we don't care about

            class_name = self.model.names[class_id]
            confidence = float(box.conf[0])
            track_id = int(box.id[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()

            tracked_objects.append({
                "track_id": track_id,
                "class_name": class_name,
                "confidence": confidence,
                "box": (int(x1), int(y1), int(x2), int(y2))
            })

        return tracked_objects
