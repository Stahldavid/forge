package dev.forgeos.adapter;

public final class Service {
  private final String name;
  private final String transport;
  private String baseUrl;
  private String command;
  private String health;

  public Service(String name, String transport, String baseUrl, String command, String health) {
    this.name = name;
    this.transport = transport;
    this.baseUrl = baseUrl;
    this.command = command;
    this.health = health;
  }

  public String name() {
    return name;
  }

  public String getName() {
    return name;
  }

  public String transport() {
    return transport;
  }

  public String getTransport() {
    return transport;
  }

  public String baseUrl() {
    return baseUrl;
  }

  public String getBaseUrl() {
    return baseUrl;
  }

  public String command() {
    return command;
  }

  public String getCommand() {
    return command;
  }

  public String health() {
    return health;
  }

  public String getHealth() {
    return health;
  }

  void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  void setHealth(String health) {
    this.health = health;
  }
}
