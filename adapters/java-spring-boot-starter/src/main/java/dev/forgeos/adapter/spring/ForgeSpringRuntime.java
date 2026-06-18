package dev.forgeos.adapter.spring;

import com.fasterxml.jackson.databind.JsonNode;
import dev.forgeos.adapter.Forge;
import dev.forgeos.adapter.ForgeContext;
import dev.forgeos.adapter.ForgeHandler;
import dev.forgeos.adapter.ForgeRegistry;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.util.ReflectionUtils;

public final class ForgeSpringRuntime {
  private ForgeSpringRuntime() {
  }

  public static ForgeRegistry buildRegistry(ApplicationContext context) {
    String[] serviceBeanNames = context.getBeanNamesForAnnotation(ForgeExternalService.class);
    if (serviceBeanNames.length == 0) {
      throw new IllegalStateException("no @ForgeExternalService bean found");
    }

    Object serviceBean = context.getBean(serviceBeanNames[0]);
    Class<?> serviceClass = AopUtils.getTargetClass(serviceBean);
    ForgeExternalService service = AnnotatedElementUtils.findMergedAnnotation(
        serviceClass,
        ForgeExternalService.class
    );
    if (service == null) {
      throw new IllegalStateException("selected bean is missing @ForgeExternalService");
    }

    ForgeRegistry registry = Forge.service(service.name(),
        Forge.framework(service.framework()),
        Forge.baseUrl(service.baseUrl()),
        Forge.health(service.health())
    );

    ReflectionUtils.doWithMethods(serviceClass, method -> registerMethod(registry, serviceBean, method));
    return registry;
  }

  private static void registerMethod(ForgeRegistry registry, Object bean, Method method) {
    ForgeCommand command = AnnotatedElementUtils.findMergedAnnotation(method, ForgeCommand.class);
    if (command != null) {
      registry.command(command.name(), handlerFor(bean, method),
          command.description().isBlank() ? entry -> { } : Forge.description(command.description()),
          command.path().isBlank() ? entry -> { } : Forge.path(command.path()),
          command.policy().isBlank() ? entry -> { } : Forge.policy(command.policy()),
          Forge.tenantScoped(command.tenantScoped()),
          Forge.transaction(command.transaction()),
          Forge.risk(command.risk()),
          Forge.needsApproval(command.needsApproval()),
          Forge.effects(command.effects())
      );
    }

    ForgeQuery query = AnnotatedElementUtils.findMergedAnnotation(method, ForgeQuery.class);
    if (query != null) {
      registry.query(query.name(), handlerFor(bean, method),
          query.description().isBlank() ? entry -> { } : Forge.description(query.description()),
          query.path().isBlank() ? entry -> { } : Forge.path(query.path()),
          query.policy().isBlank() ? entry -> { } : Forge.policy(query.policy()),
          Forge.tenantScoped(query.tenantScoped()),
          Forge.readOnly()
      );
    }
  }

  private static ForgeHandler handlerFor(Object bean, Method method) {
    ReflectionUtils.makeAccessible(method);
    return (context, args) -> {
      try {
        return method.invoke(bean, argumentsFor(method, context, args));
      } catch (InvocationTargetException error) {
        Throwable target = error.getTargetException();
        if (target instanceof Exception exception) {
          throw exception;
        }
        throw new RuntimeException(target);
      }
    };
  }

  private static Object[] argumentsFor(Method method, ForgeContext context, JsonNode args) throws Exception {
    Parameter[] parameters = method.getParameters();
    Object[] values = new Object[parameters.length];
    for (int index = 0; index < parameters.length; index += 1) {
      Class<?> type = parameters[index].getType();
      if (type.equals(ForgeContext.class)) {
        values[index] = context;
      } else {
        JsonNode safeArgs = args == null || args.isNull()
            ? dev.forgeos.adapter.Json.MAPPER.createObjectNode()
            : args;
        values[index] = dev.forgeos.adapter.Json.MAPPER.treeToValue(safeArgs, type);
      }
    }
    return values;
  }
}
