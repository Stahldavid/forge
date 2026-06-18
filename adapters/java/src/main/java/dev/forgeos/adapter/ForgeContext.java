package dev.forgeos.adapter;

import java.util.List;
import java.util.Map;

public record ForgeContext(
    Auth auth,
    ForgeCall forge,
    Map<String, List<String>> headers
) {
}
