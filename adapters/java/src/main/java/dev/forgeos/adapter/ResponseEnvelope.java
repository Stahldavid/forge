package dev.forgeos.adapter;

import java.util.List;

public record ResponseEnvelope(
    boolean ok,
    Object result,
    List<Diagnostic> diagnostics,
    ErrorInfo error,
    String traceId
) {
  public static ResponseEnvelope ok(Object result, String traceId) {
    return new ResponseEnvelope(true, result, null, null, traceId);
  }

  public static ResponseEnvelope error(String code, String message, String traceId) {
    return new ResponseEnvelope(
        false,
        null,
        List.of(Diagnostic.error(code, message == null || message.isBlank() ? code : message)),
        new ErrorInfo(code, message == null || message.isBlank() ? code : message),
        traceId
    );
  }
}
