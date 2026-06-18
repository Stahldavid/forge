package dev.forgeos.adapter;

import java.util.List;
import java.util.Map;

public record Auth(
    String kind,
    String userId,
    String tenantId,
    String role,
    List<String> roles,
    List<String> permissions,
    String email,
    String name,
    Map<String, Object> claims
) {
  public static Auth anonymous() {
    return new Auth("anonymous", null, null, null, null, null, null, null, null);
  }
}
