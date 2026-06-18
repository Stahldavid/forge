package dev.forgeos.adapter.spring;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ForgeExternalService {
  String name();
  String baseUrl() default "";
  String framework() default "spring-boot";
  String health() default "/health";
}
