<#assign actions = requiredActions![]>
<#assign passwordOnly = actions?size == 1 && actions[0] == "UPDATE_PASSWORD">
<#import "template.ftl" as layout>
<@layout.emailLayout preheader=passwordOnly?then("Set a password for your YADA DSOaaS account.", "Update your YADA DSOaaS account.")>
  <#if passwordOnly>
    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#128ea3;">Password</p>
    <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:700;color:#241c18;">Set your password</h1>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#241c18;">An administrator asked you to set a password for your ${realmName} account. This message does not contain a password.</p>
    <@layout.button href=link label="Set a new password" />
  <#else>
    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#128ea3;">Account</p>
    <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:700;color:#241c18;">Update your account</h1>
    <p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#241c18;">An administrator asked you to update your ${realmName} account:</p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#241c18;">
      <#list actions as action>
        <li style="margin:0 0 4px;">${msg("requiredAction.${action}")}</li>
      </#list>
    </ul>
    <@layout.button href=link label="Continue" />
  </#if>
  <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b5348;">This link expires within ${linkExpirationFormatter(linkExpiration)}. If you were not expecting it, ignore this message and nothing will change.</p>
</@layout.emailLayout>
