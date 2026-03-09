from flask import Flask, Response
import cv2

app = Flask(__name__)
camera = cv2.VideoCapture(0)

def generate_frames():
    while True:
        success, frame = camera.read()
        if not success:
            break
        else:
            ret, buffer = cv2.imencode('.jpg', frame)
            frame = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route('/video_feed/<code>')
def video_feed(code):
    if code == "356868":
        return Response(generate_frames(),
            mimetype='multipart/x-mixed-replace; boundary=frame')
    else:
        return "Invalid Code"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)