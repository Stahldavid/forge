package dev.forgeos.adapter;

import java.util.List;
import java.util.Map;

public record Manifest(
    String forgeProtocol,
    String language,
    String framework,
    Service service,
    List<Entry> entries,
    Map<String, Object> schemas
) {
}
