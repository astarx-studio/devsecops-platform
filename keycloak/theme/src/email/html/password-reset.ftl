<#import "template.ftl" as layout>
<@layout.emailLayout preheader="Set a new password for your YADA DSOaaS account.">
  <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#128ea3;">Password</p>
  <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:700;color:#241c18;">Reset your password</h1>
  <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#241c18;">Someone asked to change the password for your ${realmName} account. If that was you, use the button below. If it was not, ignore this message and the password stays as it is.</p>
  <@layout.button href=link label="Set a new password" />
  <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b5348;">This link expires within ${linkExpirationFormatter(linkExpiration)}.</p>
</@layout.emailLayout>
