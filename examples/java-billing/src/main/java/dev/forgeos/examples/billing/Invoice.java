package dev.forgeos.examples.billing;

public record Invoice(
    String id,
    String title,
    String tenant,
    String traceId,
    String authKind,
    String userId
) {
}
