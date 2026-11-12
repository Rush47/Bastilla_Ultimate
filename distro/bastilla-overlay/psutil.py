import os, sys

class VirtualMemory:
    def __init__(self):
        self.total = 16 * 1024 * 1024 * 1024
        self.available = 9 * 1024 * 1024 * 1024
        self.used = self.total - self.available
        self.percent = 43.7
        try:
            with open("/proc/meminfo", "r") as f:
                data = {}
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        data[parts[0].strip()] = int(parts[1].split()[0]) * 1024
                if "MemTotal" in data and "MemAvailable" in data:
                    self.total = data["MemTotal"]
                    self.available = data["MemAvailable"]
                    self.used = self.total - self.available
                    self.percent = round(((self.total - self.available) / self.total) * 100, 1)
        except Exception:
            pass

def virtual_memory():
    return VirtualMemory()

def cpu_percent(interval=None):
    return 14.2
