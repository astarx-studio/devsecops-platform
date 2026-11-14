package dev.yada.keycloak.email;

import org.keycloak.Config;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.email.EmailSenderProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public class PersonalInboxEmailSenderProviderFactory implements EmailSenderProviderFactory {

    @Override
    public EmailSenderProvider create(KeycloakSession session) {
        return new PersonalInboxEmailSenderProvider(session.getProvider(EmailSenderProvider.class, "default"));
    }

    @Override
    public void init(Config.Scope config) {
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
    }

    @Override
    public void close() {
    }

    @Override
    public String getId() {
        return "personal-inbox";
    }

    @Override
    public int order() {
        return 10;
    }
}
