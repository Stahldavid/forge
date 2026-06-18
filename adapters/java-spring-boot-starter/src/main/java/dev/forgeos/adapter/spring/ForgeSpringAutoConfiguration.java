package dev.forgeos.adapter.spring;

import dev.forgeos.adapter.ForgeRegistry;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;

@AutoConfiguration
public class ForgeSpringAutoConfiguration {
  @Bean
  @Conditional(ForgeServiceBeanCondition.class)
  public ForgeRegistry forgeRegistry(ApplicationContext context) {
    return ForgeSpringRuntime.buildRegistry(context);
  }
}
