"""
Boundary line logic:
 - drawing the line on screen (Stage 4)
 - detecting when a tracked object crosses it (Stage 5)
"""

import cv2
import config


def draw_boundary(frame):
    """Draw the configured boundary line onto the frame."""
    cv2.line(
        frame,
        config.BOUNDARY_START,
        config.BOUNDARY_END,
        config.BOUNDARY_COLOR,
        config.BOUNDARY_THICKNESS
    )

    label_pos = (config.BOUNDARY_START[0] + 10, config.BOUNDARY_START[1] - 10)
    cv2.putText(
        frame,
        "BOUNDARY",
        label_pos,
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        config.BOUNDARY_COLOR,
        2
    )

    return frame


def get_reference_point(box):
    """
    Returns the point we use to represent an object's position:
    the bottom-center of its bounding box (roughly its feet/wheels).
    This is more accurate for ground-crossing than using the box center.
    """
    x1, y1, x2, y2 = box
    center_x = (x1 + x2) // 2
    bottom_y = y2
    return (center_x, bottom_y)


def get_side(point, line_start, line_end):
    """
    Returns which side of the line a point is on:
        -1 = one side, +1 = the other side, 0 = exactly on the line.
    Uses the sign of a cross product - the math detail doesn't matter,
    only that the SIGN flipping means the point crossed the line.
    """
    x, y = point
    x1, y1 = line_start
    x2, y2 = line_end

    cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)

    if cross > 0:
        return 1
    elif cross < 0:
        return -1
    else:
        return 0


class CrossingDetector:
    """
    Keeps track of which side of the boundary each tracked object (by ID)
    was on last frame, so we can detect the moment it flips sides.
    """

    def __init__(self):
        # Maps track_id -> last known side (-1 or 1)
        self.last_side = {}

    def update(self, tracked_objects):
        """
        Call this once per frame with the current list of tracked objects.
        Returns a list of crossing events that happened THIS frame:
            [{"track_id": 3, "class_name": "person"}, ...]
        """
        events = []
        seen_ids = set()

        for obj in tracked_objects:
            track_id = obj["track_id"]
            seen_ids.add(track_id)

            point = get_reference_point(obj["box"])
            side = get_side(point, config.BOUNDARY_START, config.BOUNDARY_END)

            if side == 0:
                # Exactly on the line - ambiguous, just skip this frame for this object.
                continue

            previous_side = self.last_side.get(track_id)

            if previous_side is not None and side != previous_side:
                # Side changed since last frame -> a crossing just happened.
                events.append({
                    "track_id": track_id,
                    "class_name": obj["class_name"],
                    "direction": f"side {previous_side} to side {side}"
                })

            self.last_side[track_id] = side

        # Housekeeping: forget objects that are no longer being tracked,
        # so old IDs don't quietly pile up in memory over a long run.
        stale_ids = set(self.last_side.keys()) - seen_ids
        for stale_id in stale_ids:
            del self.last_side[stale_id]

        return events
