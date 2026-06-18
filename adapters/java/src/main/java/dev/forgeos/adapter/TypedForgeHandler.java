package dev.forgeos.adapter;

@FunctionalInterface
public interface TypedForgeHandler<In, Out> {
  Out handle(ForgeContext context, In input) throws Exception;
}
