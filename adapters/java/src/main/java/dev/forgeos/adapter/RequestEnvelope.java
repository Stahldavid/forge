package dev.forgeos.adapter;

import com.fasterxml.jackson.databind.JsonNode;

public record RequestEnvelope(JsonNode args, Auth auth, ForgeCall forge) {
}
