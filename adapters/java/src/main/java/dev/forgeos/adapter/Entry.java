package dev.forgeos.adapter;

import java.util.ArrayList;
import java.util.List;

public final class Entry {
  public String name;
  public String kind;
  public String description;
  public String path;
  public String method;
  public Object inputSchema;
  public Object outputSchema;
  public String policy;
  public Boolean tenantScoped;
  public String transaction;
  public String risk;
  public Boolean needsApproval;
  public List<String> effects;

  public Entry copy() {
    Entry copy = new Entry();
    copy.name = name;
    copy.kind = kind;
    copy.description = description;
    copy.path = path;
    copy.method = method;
    copy.inputSchema = inputSchema;
    copy.outputSchema = outputSchema;
    copy.policy = policy;
    copy.tenantScoped = tenantScoped;
    copy.transaction = transaction;
    copy.risk = risk;
    copy.needsApproval = needsApproval;
    copy.effects = effects == null ? null : new ArrayList<>(effects);
    return copy;
  }
}
