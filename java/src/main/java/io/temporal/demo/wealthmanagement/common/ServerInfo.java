package io.temporal.demo.wealthmanagement.common;

/**
 * Task queue names, read from the same environment variables as the TypeScript ClientHelper.
 */
public final class ServerInfo {
    private ServerInfo() {
    }

    // Task queue of the TypeScript worker, which hosts the activities
    public static String getTaskqueue() {
        return getEnv("TEMPORAL_TASK_QUEUE", "VAISupervisor");
    }

    private static String getEnv(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isEmpty() ? defaultValue : value;
    }
}
