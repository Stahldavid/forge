package dev.forgeos.adapter.spring;

import dev.forgeos.adapter.Risk;
import dev.forgeos.adapter.TransactionMode;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ForgeCommand {
  String name();
  String description() default "";
  String path() default "";
  String policy() default "";
  boolean tenantScoped() default false;
  TransactionMode transaction() default TransactionMode.EXTERNAL_MANAGED;
  Risk risk() default Risk.WRITE;
  boolean needsApproval() default false;
  String[] effects() default {};
}
