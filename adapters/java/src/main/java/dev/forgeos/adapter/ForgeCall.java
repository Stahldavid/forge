package dev.forgeos.adapter;

public record ForgeCall(String service, String entry, String kind, String traceId) {
  public ForgeCall withDefaults(String serviceName, String entryName, String entryKind, String fallbackTraceId) {
    return new ForgeCall(
        service == null || service.isBlank() ? serviceName : service,
        entry == null || entry.isBlank() ? entryName : entry,
        kind == null || kind.isBlank() ? entryKind : kind,
        traceId == null || traceId.isBlank() ? fallbackTraceId : traceId
    );
  }
}
