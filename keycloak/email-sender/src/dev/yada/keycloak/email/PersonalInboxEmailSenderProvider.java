package dev.yada.keycloak.email;

import java.util.Map;
import java.util.logging.Logger;

import org.keycloak.email.EmailException;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.models.UserModel;

/**
 * Delivers the same Keycloak message to the personal inbox stored on the user.
 * Account mail still goes to the company address. A forward of that copy is not
 * how the person receives a confirmation or a password link.
 */
public class PersonalInboxEmailSenderProvider implements EmailSenderProvider {

    static final String PERSONAL_EMAIL = "personalEmail";

    private static final Logger LOG = Logger.getLogger(PersonalInboxEmailSenderProvider.class.getName());

    private final EmailSenderProvider delegate;

    public PersonalInboxEmailSenderProvider(EmailSenderProvider delegate) {
        this.delegate = delegate;
    }

    @Override
    public void send(Map<String, String> config, UserModel user, String subject, String textBody, String htmlBody)
            throws EmailException {
        delegate.send(config, user, subject, textBody, htmlBody);
        String personal = personalInbox(user);
        if (personal == null) {
            return;
        }
        try {
            delegate.send(config, personal, subject, textBody, htmlBody);
        } catch (EmailException ex) {
            LOG.warning("Personal inbox copy failed after the account address was accepted");
            throw ex;
        }
    }

    @Override
    public void send(Map<String, String> config, String address, String subject, String textBody, String htmlBody)
            throws EmailException {
        delegate.send(config, address, subject, textBody, htmlBody);
    }

    @Override
    public void validate(Map<String, String> config) throws EmailException {
        delegate.validate(config);
    }

    @Override
    public void close() {
    }

    static String personalInbox(UserModel user) {
        if (user == null) {
            return null;
        }
        String personal = user.getFirstAttribute(PERSONAL_EMAIL);
        if (personal == null) {
            return null;
        }
        personal = personal.trim();
        if (personal.isEmpty()) {
            return null;
        }
        String account = user.getEmail();
        if (account != null && personal.equalsIgnoreCase(account.trim())) {
            return null;
        }
        return personal;
    }
}
