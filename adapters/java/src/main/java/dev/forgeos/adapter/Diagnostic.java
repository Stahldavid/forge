package dev.forgeos.adapter;

import java.util.List;

public record Diagnostic(
    String severity,
    String code,
    String message,
    String file,
    String fixHint,
    List<String> docs
) {
  public static Diagnostic error(String code, String message) {
    return new Diagnostic("error", code, message, null, null, List.of("docs/forge-protocol.md"));
  }
}
