import os


class ClientHelper:
    def __init__(self):
        host = os.getenv("TEMPORAL_ADDRESS", "127.0.0.1:7233")
        namespace = os.getenv("TEMPORAL_NAMESPACE", "default")
        self.client_config = {
            "target_host": host,
            "namespace": namespace,
        }
        self.address = host
        self.namespace = namespace
        self.taskQueue = os.getenv("TEMPORAL_TASK_QUEUE", "VAISupervisor")
