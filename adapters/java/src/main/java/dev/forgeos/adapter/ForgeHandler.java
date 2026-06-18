package dev.forgeos.adapter;

import com.fasterxml.jackson.databind.JsonNode;

@FunctionalInterface
public interface ForgeHandler {
  Object handle(ForgeContext context, JsonNode args) throws Exception;
}
