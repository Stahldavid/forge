package dev.forgeos.adapter;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Schemas {
  private Schemas() {
  }

  public static Map<String, Object> object(Map<String, Object> properties, String... required) {
    Map<String, Object> schema = new LinkedHashMap<>();
    schema.put("type", "object");
    schema.put("properties", properties);
    if (required.length > 0) {
      schema.put("required", List.of(required));
    }
    return schema;
  }

  public static Map<String, Object> string() {
    return Map.of("type", "string");
  }

  public static Map<String, Object> bool() {
    return Map.of("type", "boolean");
  }

  public static Map<String, Object> number() {
    return Map.of("type", "number");
  }

  public static Map<String, Object> array(Object items) {
    return Map.of("type", "array", "items", items);
  }
}
