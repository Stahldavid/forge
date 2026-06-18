package dev.forgeos.adapter.spring;

import org.springframework.beans.factory.BeanFactory;
import org.springframework.beans.factory.ListableBeanFactory;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

public final class ForgeServiceBeanCondition implements Condition {
  @Override
  public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
    BeanFactory beanFactory = context.getBeanFactory();
    if (!(beanFactory instanceof ListableBeanFactory listable)) {
      return false;
    }
    return !listable.getBeansWithAnnotation(ForgeExternalService.class).isEmpty();
  }
}
