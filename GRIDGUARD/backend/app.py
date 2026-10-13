
from pathlib import Path
import random
import time

from flask import Flask, jsonify, request, send_from_directory

from simulation.pipeline import create_pipeline_network
from simulation.leak_simulator import simulate_leak
from simulation.sensor_simulator import generate_pressure_readings
from detection.leak_detector import detect_leaks


# --------------------------------------------------
# GRIDGUARD: Python API
# --------------------------------------------------

PROJECT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"

app = Flask(
    __name__,
    static_folder=str(FRONTEND_DIR),
    static_url_path=""
)

# The active leak is stored while this server is running.
active_leak = None

# Stable positions for the pipeline visualization.
NODE_POSITIONS = {
    "Tank": {"x": 8, "y": 48},
    "J1":   {"x": 29, "y": 48},
    "J2":   {"x": 51, "y": 24},
    "J3":   {"x": 51, "y": 73},
    "J4":   {"x": 74, "y": 48},
    "J5":   {"x": 93, "y": 48},
}


def get_network():
    """Build the pipeline and apply the active simulated leak."""
    network = create_pipeline_network()

    if active_leak:
        simulate_leak(
            network,
            active_leak["pipe_start"],
            active_leak["pipe_end"],
            leak_severity=active_leak["severity"]
        )

    return network


def build_dashboard_data():
    """Create the data payload consumed by the frontend."""
    network = get_network()

    # Use the same seed for healthy and affected readings so
    # the comparison reflects the simulated leak effect.
    seed = int(time.time() // 3) % 100000

    leak_pipe = None
    if active_leak:
        leak_pipe = (
            active_leak["pipe_start"],
            active_leak["pipe_end"]
        )

    healthy_pressure = generate_pressure_readings(
        network,
        leak_pipe=None,
        seed=seed
    )

    pressure = generate_pressure_readings(
        network,
        leak_pipe=leak_pipe,
        seed=seed
    )

    rng = random.Random(seed)

    flow = {}
    for index, junction in enumerate(network.nodes):
        base_flow = 24.0 - index * 1.6
        variation = rng.uniform(-0.7, 0.7)

        leak_effect = 0.0
        if active_leak and junction in leak_pipe:
            leak_effect = 8.0 * active_leak["severity"]

        flow[junction] = round(
            max(0.0, base_flow + variation + leak_effect),
            2
        )

    nodes = []

    for junction in network.nodes:
        nodes.append({
            "id": junction,
            "x": NODE_POSITIONS[junction]["x"],
            "y": NODE_POSITIONS[junction]["y"],
            "pressure": pressure[junction],
            "healthy_pressure": healthy_pressure[junction],
            "flow": flow[junction],
            "status": (
                "warning"
                if active_leak and junction in leak_pipe
                else "normal"
            )
        })

    edges = []

    for start, end, data in network.edges(data=True):
        severity = data.get("leak_severity", 0.0)
        is_leaking = data.get("leak", False)

        edges.append({
            "id": f"{start}-{end}",
            "start": start,
            "end": end,
            "length": data["length"],
            "leak": is_leaking,
            "severity": severity,
            "status": "leak" if is_leaking else "normal"
        })

    # This is the existing baseline detector. It reads the
    # simulation's leak labels; it is not yet an independent
    # sensor-based AI detection algorithm.
    raw_detections = detect_leaks(network)
    detections = []

    for item in raw_detections:
        severity = float(item.get("severity", 0.0))

        if severity >= 0.7:
            priority = "High"
        elif severity >= 0.4:
            priority = "Medium"
        else:
            priority = "Low"

        detections.append({
            "pipe": item["pipe"],
            "severity": round(severity, 2),
            "priority": priority,
            "status": "Detected"
        })

    average_pressure = round(
        sum(pressure.values()) / len(pressure),
        2
    )

    average_flow = round(
        sum(flow.values()) / len(flow),
        2
    )

    return {
        "project": "GRIDGUARD",
        "mode": "simulation",
        "generated_at": time.strftime(
            "%Y-%m-%d %H:%M:%S"
        ),
        "network": {
            "node_count": network.number_of_nodes(),
            "pipe_count": network.number_of_edges(),
            "nodes": nodes,
            "edges": edges
        },
        "telemetry": {
            "pressure": pressure,
            "healthy_pressure": healthy_pressure,
            "flow": flow,
            "average_pressure": average_pressure,
            "average_flow": average_flow
        },
        "detections": detections,
        "summary": {
            "active_leaks": len(detections),
            "network_status": (
                "Attention Required"
                if detections
                else "All Clear"
            ),
            "average_pressure": average_pressure,
            "average_flow": average_flow
        }
    }


# --------------------------------------------------
# API ROUTES
# --------------------------------------------------

@app.route("/")
def home():
    """Serve the frontend dashboard."""
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "service": "GRIDGUARD API",
        "mode": "simulation"
    })


@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    return jsonify(build_dashboard_data())


@app.route("/api/simulate-leak", methods=["POST"])
def simulate_leak_route():
    global active_leak

    body = request.get_json(silent=True) or {}

    pipe_start = body.get("pipe_start", "J1")
    pipe_end = body.get("pipe_end", "J2")

    try:
        severity = float(body.get("severity", 0.5))
    except (TypeError, ValueError):
        return jsonify({
            "error": "Severity must be a number."
        }), 400

    if not 0.0 <= severity <= 1.0:
        return jsonify({
            "error": "Severity must be between 0 and 1."
        }), 400

    network = create_pipeline_network()

    if not network.has_edge(pipe_start, pipe_end):
        return jsonify({
            "error": f"Pipe {pipe_start}-{pipe_end} does not exist."
        }), 400

    active_leak = {
        "pipe_start": pipe_start,
        "pipe_end": pipe_end,
        "severity": severity
    }

    return jsonify({
        "message": "Simulated leak activated.",
        "dashboard": build_dashboard_data()
    })


@app.route("/api/reset", methods=["POST"])
def reset_network():
    global active_leak

    active_leak = None

    return jsonify({
        "message": "Network reset to healthy simulation.",
        "dashboard": build_dashboard_data()
    })


@app.errorhandler(500)
def internal_error(error):
    app.logger.exception("GRIDGUARD API error")

    return jsonify({
        "error": "An internal server error occurred."
    }), 500


if __name__ == "__main__":
    print("=" * 48)
    print("GRIDGUARD API")
    print("Simulation mode: ON")
    print("Dashboard: http://127.0.0.1:5000")
    print("=" * 48)

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )
