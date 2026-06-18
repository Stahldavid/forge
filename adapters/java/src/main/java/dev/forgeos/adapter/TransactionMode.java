package dev.forgeos.adapter;

public enum TransactionMode {
  READ_ONLY("read-only"),
  EXTERNAL_MANAGED("external-managed"),
  FORGE_MANAGED("forge-managed"),
  SAGA("saga");

  private final String value;

  TransactionMode(String value) {
    this.value = value;
  }

  public String value() {
    return value;
  }
}
