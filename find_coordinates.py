"""
Helper tool (not part of the main app): click on the webcam feed to print
pixel coordinates to the terminal. Use this to figure out good values for
BOUNDARY_START / BOUNDARY_END in config.py.

Run it, click two points where you want your line, note the printed
coordinates, then put them into config.py. Press 'q' to quit.
"""

import cv2
import config


def on_click(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN:
        print(f"Clicked at: ({x}, {y})")


def main():
    cap = cv2.VideoCapture(config.CAMERA_INDEX, cv2.CAP_DSHOW)

    if not cap.isOpened():
        print("ERROR: Could not open camera.")
        return

    window_name = "Click to get coordinates - press q to quit"
    cv2.namedWindow(window_name)
    cv2.setMouseCallback(window_name, on_click)

    print("Click anywhere on the video to print its coordinates.")
    print("Click your desired start point, then your desired end point.")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        cv2.imshow(window_name, frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
