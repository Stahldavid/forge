package dev.forgeos.adapter;

public enum Risk {
  READ("read"),
  WRITE("write"),
  DESTRUCTIVE("destructive"),
  EXTERNAL("external");

  private final String value;

  Risk(String value) {
    this.value = value;
  }

  public String value() {
    return value;
  }
}
