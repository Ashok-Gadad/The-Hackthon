
def detect_leaks(network):
    """
    Baseline detector for testing the simulation.

    Note: This version reads leak labels directly.
    It is only a temporary test, not the final AI detector.
    """
    detected_pipes = []

    for start, end, data in network.edges(data=True):
        if data.get("leak", False):
            detected_pipes.append({
                "pipe": f"{start}-{end}",
                "severity": data.get("leak_severity", 0.0),
            })

    return detected_pipes


if __name__ == "__main__":
    from simulation.pipeline import create_pipeline_network
    from simulation.leak_simulator import simulate_leak

    pipeline = create_pipeline_network()
    simulate_leak(pipeline, "J1", "J2", leak_severity=0.3)

    results = detect_leaks(pipeline)

    print("GRIDGUARD Leak Detection")
    print("Detected leaking pipes:")

    for result in results:
        print(
            f"{result['pipe']} | "
            f"Severity: {result['severity']}"
        )
