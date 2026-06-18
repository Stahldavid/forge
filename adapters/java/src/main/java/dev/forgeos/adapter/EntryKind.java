package dev.forgeos.adapter;

public enum EntryKind {
  COMMAND("command"),
  QUERY("query");

  private final String value;

  EntryKind(String value) {
    this.value = value;
  }

  public String value() {
    return value;
  }
}
