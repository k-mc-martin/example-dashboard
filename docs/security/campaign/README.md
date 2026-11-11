# SecDash manual review (optional)

[Launch the exercise picker](https://vps-ca027b84.vps.ovh.us/launch) · [Deployed commit](https://vps-ca027b84.vps.ovh.us/version) · [Campaign CI](https://github.com/k-mc-martin/example-dashboard/actions/workflows/campaign.yml) · [Scanner evidence](https://github.com/k-mc-martin/example-dashboard/actions/workflows/security-tools.yml) · [Rules and limits](policy.md)

Choose a card, then a fictional role for interactive exercises. The dashboard opens to the first relevant screen. Use the dashboard navigation to reach the other screens listed below. Verification results open directly for evidence reviews. **Sign out** changes identity inside the same exercise. **Choose another exercise** starts a fresh workspace and ends the old dashboard logins when you select a card. A private browser window is a second, independent visitor. Owner → Teams opens a second member in the same workspace. Only the example dashboard and its fictional providers are in scope.

For each review, record the deployed commit, date, browser, role, request or steps, expected and actual result, and evidence. Download observations from a dashboard screen where you ran a check before signing out. Do not include passwords, raw cookies, access tokens or activation codes. Use [the blank results sheet](manual-results.csv) for a private working copy; publish only redacted observations. Opening a card or receiving an error alone is not a passing grade. Confirm a positive control and the resulting data or absence of a side effect.

Use **Download exercise report (PDF)** on an exercise screen to export the backend receipts. The Owner can collect receipts across roles in the same workspace. To run the automated scenarios, use **Run all 19 exercises** on the picker. The suite PDF includes the actual HTTP responses, assertion outcomes, and build revision.

## Exercise directory

| # | Exercise | Dashboard screens | What to try |
|---|---|---|---|
| 1 | Account permissions | Payments & refunds | In Payments & refunds, select Submit refund as Mira, then try Approve refund. Read the payment ledger to check the state. Sign out and select Inez to approve the same refund. |
| 2 | Access another person’s records | Client records, Payments & refunds | As Mira open both client files, then attempt approval. As Owner repeat the same requests, including approval after submission. |
| 3 | Agent tool permissions | Connectors | In Connectors, consent to read mail, then exchange the code. List the tools and call refund_request directly. As Owner, consent to request refunds and exchange that code before trying the same tool. |
| 4 | Credential lifecycle | Connectors | Issue a code, exchange it, rotate the refresh token, then replay it. Try the old access token. A short-lived grant lets you test expiry. |
| 5 | Concurrent requests | Payments & refunds, Audit log | As Inez, submit a refund in Payments & refunds. From Teams, open Mira’s session. Send four approval requests together from each tab, then compare the responses, payment ledger and Owner’s audit log. |
| 6 | Remove access mid-session | Teams, Client records, Audit log | As Owner open Mira from Teams. Load her record, disable her, and try again in her tab. Re-enabling her should require a new login. |
| 7 | Failure and recovery | Payments & refunds | Submit, approve, then interrupt the provider response. Inspect the ledger before retrying. Also try an outage before delivery. |
| 8 | Server and dependency checks | Verification results | In Verification results, select Inspect server and dependency checks. Compare the scanner findings and live response headers, then open the Hosted boundary run to inspect TLS. |
| 9 | Detect a planted fault | Payments & refunds | In Payments & refunds, open Receipt reconciliation. Check the healthy receipt, then the duplicated receipt. Read the ledger to see whether either check changed the payment. |
| 10 | Audit and reproduce | Payments & refunds, Audit log | As Owner submit a refund, approve it, then repeat the approval. Open Audit log to inspect the ordered events and download the observations for this run. |
| 11 | Untrusted agent content | Connectors, Payments & refunds | In Connectors, consent to read mail and exchange the code. Read the untrusted message, then call the refund tool it asks for. Open Payments & refunds and inspect the ledger. |
| 12 | Confused deputy and token passthrough | Connectors | Try a redirect outside the registered client, then try an invalid audience and an upstream token. Compare with an expressly consented read. |
| 13 | Secrets and source scanning | Verification results | In Verification results, select Inspect source scan results. Compare the source and full-history scans with the deleted-secret and Semgrep rule controls. |
| 14 | Environment isolation | Client records | Open an independent private browser window. Copy a record ID between workspaces and compare the response to a local record. Inspect the isolated provider configuration. |
| 15 | Continuous verification | Verification results | In Verification results, select Inspect this build’s runs. Compare the deployed revision and browser and server checks with their linked GitHub runs. Open the workflow source to see how to repeat them. |
| 16 | Bad-input attacks | Communications, Client records, Payments & refunds | Edit the sample text and send it. Compare a legitimate search to a poisoned one. Try adding an unexpected field to a payment request. |
| 17 | Attacks from another website | Payments & refunds | Check the payment state, launch the separate test site and try its form and script. Return here and read the ledger again. |
| 18 | Staff sign-in | Staff access | Enroll a fictional staff login. Try the protected record before and after signing in, change the password, and test repeated wrong guesses. |
| 19 | Sensitive records and approvals | Client records, Payments & refunds | Compare the two client records as Employee and Owner. Try settling a refund first, then submit, approve and settle in order. |

## ASVS requirement checklist

70 unique Level 1 requirements are assigned once below. Exercises without Level 1 rows still have their own scenario. Earlier manual evidence applies only to the commit and checks in the [account log](../accounts.md#manual-verification-log). The current build awaits your manual verdicts. Review additional evidence in CI; a single scenario does not establish ASVS conformance.

### Bad-input attacks

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 1.2.1 | 16 | Verify that output encoding for an HTTP response, HTML document, or XML document is relevant for the context required, such as encoding the relevant characters for HTML elements, HTML attributes, HTML comments, CSS, or HTTP header fields, to avoid changing the message or document structure. |
| 1.2.2 | 16 | Verify that when dynamically building URLs, untrusted data is encoded according to its context (e.g., URL encoding or base64url encoding for query or path parameters). Ensure that only safe URL protocols are permitted (e.g., disallow javascript: or data:). |
| 1.2.3 | 16 | Verify that output encoding or escaping is used when dynamically building JavaScript content (including JSON), to avoid changing the message or document structure (to avoid JavaScript and JSON injection). |
| 1.2.4 | 16 | Verify that data selection or database queries (e.g., SQL, HQL, NoSQL, Cypher) use parameterized queries, ORMs, entity frameworks, or are otherwise protected from SQL Injection and other database injection attacks. This is also relevant when writing stored procedures. |
| 1.2.5 | 16 | Verify that the application protects against OS command injection and that operating system calls use parameterized OS queries or use contextual command line output encoding. |
| 1.3.2 | 16 | Verify that the application avoids the use of eval() or other dynamic code execution features such as Spring Expression Language (SpEL). Where there is no alternative, any user input being included must be sanitized before being executed. |
| 2.1.1 | 16 | Verify that the application's documentation defines input validation rules for how to check the validity of data items against an expected structure. This could be common data formats such as credit card numbers, email addresses, telephone numbers, or it could be an internal data format. |
| 2.2.1 | 16 | Verify that input is validated to enforce business or functional expectations for that input. This should either use positive validation against an allow list of values, patterns, and ranges, or be based on comparing the input to an expected structure and logical limits according to predefined rules. For L1, this can focus on input which is used to make specific business or security decisions. For L2 and up, this should apply to all input. |
| 2.2.2 | 16 | Verify that the application is designed to enforce input validation at a trusted service layer. While client-side validation improves usability and should be encouraged, it must not be relied upon as a security control. |
| 3.2.1 | 16 | Verify that security controls are in place to prevent browsers from rendering content or functionality in HTTP responses in an incorrect context (e.g., when an API, a user-uploaded file or other resource is requested directly). Possible controls could include: not serving the content unless HTTP request header fields (such as Sec-Fetch-\*) indicate it is the correct context, using the sandbox directive of the Content-Security-Policy header field or using the attachment disposition type in the Content-Disposition header field. |
| 3.2.2 | 16 | Verify that content intended to be displayed as text, rather than rendered as HTML, is handled using safe rendering functions (such as createTextNode or textContent) to prevent unintended execution of content such as HTML or JavaScript. |

### stated with a reason

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 1.3.1 | Confirm N/A | Verify that all untrusted HTML input from WYSIWYG editors or similar is sanitized using a well-known and secure HTML sanitization library or framework feature. **Scope check:** No rich-text HTML editor. Verify message previews and mail content are plain text. |
| 1.5.1 | Confirm N/A | Verify that the application configures XML parsers to use a restrictive configuration and that unsafe features such as resolving external entities are disabled to prevent XML eXternal Entity (XXE) attacks. **Scope check:** No XML parser or XML input endpoint. Confirm against the deployed application. |
| 4.4.1 | Confirm N/A | Verify that WebSocket over TLS (WSS) is used for all WebSocket connections. **Scope check:** No production WebSocket endpoint. Inspect routes and the deployed Network panel. |
| 5.2.1 | Confirm N/A | Verify that the application will only accept files of a size which it can process without causing a loss of performance or a denial of service attack. **Scope check:** The demo accepts no file or archive uploads. Review inbound routes and confirm downloads use trusted paths. |
| 5.2.2 | Confirm N/A | Verify that when the application accepts a file, either on its own or within an archive such as a zip file, it checks if the file extension matches an expected file extension and validates that the contents correspond to the type represented by the extension. This includes, but is not limited to, checking the initial 'magic bytes', performing image re-writing, and using specialized libraries for file content validation. For L1, this can focus just on files which are used to make specific business or security decisions. For L2 and up, this must apply to all files being accepted. **Scope check:** The demo accepts no file or archive uploads. Review inbound routes and confirm downloads use trusted paths. |
| 5.3.1 | Confirm N/A | Verify that files uploaded or generated by untrusted input and stored in a public folder, are not executed as server-side program code when accessed directly with an HTTP request. **Scope check:** The demo accepts no file or archive uploads. Review inbound routes and confirm downloads use trusted paths. |
| 5.3.2 | Confirm N/A | Verify that when the application creates file paths for file operations, instead of user-submitted filenames, it uses internally generated or trusted data, or if user-submitted filenames or file metadata must be used, strict validation and sanitization must be applied. This is to protect against path traversal, local or remote file inclusion (LFI, RFI), and server-side request forgery (SSRF) attacks. **Scope check:** The demo accepts no file or archive uploads. Review inbound routes and confirm downloads use trusted paths. |

### Roles, records and approvals

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 2.3.1 | 19 | Verify that the application will only process business logic flows for the same user in the expected sequential step order and without skipping steps. |
| 8.1.1 | 1 | Verify that authorization documentation defines rules for restricting function-level and data-specific access based on consumer permissions and resource attributes. |
| 8.2.1 | 1 | Verify that the application ensures that function-level access is restricted to consumers with explicit permissions. |
| 8.2.2 | 2 | Verify that the application ensures that data-specific access is restricted to consumers with explicit permissions to specific data items to mitigate insecure direct object reference (IDOR) and broken object level authorization (BOLA). |
| 8.3.1 | 1 | Verify that the application enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate, such as client-side JavaScript. |
| 15.3.1 | 1 | Verify that the application only returns the required subset of fields from a data object. For example, it should not return an entire data object, as some individual fields should not be accessible to users. |

### Sessions and losing access

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 3.3.1 | 1 | Verify that cookies have the 'Secure' attribute set, and if the '\__Host-' prefix is not used for the cookie name, the '__Secure-' prefix must be used for the cookie name. |
| 7.2.1 | 1 | Verify that the application performs all session token verification using a trusted, backend service. |
| 7.2.2 | 1 | Verify that the application uses either self-contained or reference tokens that are dynamically generated for session management, i.e. not using static API secrets and keys. |
| 7.2.3 | 1 | Verify that if reference tokens are used to represent user sessions, they are unique and generated using a cryptographically secure pseudo-random number generator (CSPRNG) and possess at least 128 bits of entropy. |
| 7.2.4 | 1 | Verify that the application generates a new session token on user authentication, including re-authentication, and terminates the current session token. |
| 7.4.1 | 1 | Verify that when session termination is triggered (such as logout or expiration), the application disallows any further use of the session. For reference tokens or stateful sessions, this means invalidating the session data at the application backend. Applications using self-contained tokens will need a solution such as maintaining a list of terminated tokens, disallowing tokens produced before a per-user date and time or rotating a per-user signing key. |
| 7.4.2 | 6 | Verify that the application terminates all active sessions when a user account is disabled or deleted (such as an employee leaving the company). |
| 14.3.1 | 1 | Verify that authenticated data is cleared from client storage, such as the browser DOM, after the client or session is terminated. The 'Clear-Site-Data' HTTP response header field may be able to help with this but the client-side should also be able to clear up if the server connection is not available when the session is terminated. |

### Server and build checks

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 3.4.1 | 8 | Verify that a Strict-Transport-Security header field is included on all responses to enforce an HTTP Strict Transport Security (HSTS) policy. A maximum age of at least 1 year must be defined, and for L2 and up, the policy must apply to all subdomains as well. |
| 4.1.1 | 8 | Verify that every HTTP response with a message body contains a Content-Type header field that matches the actual content of the response, including the charset parameter to specify safe character encoding (e.g., UTF-8, ISO-8859-1) according to IANA Media Types, such as "text/", "/+xml" and "/xml". |
| 11.3.1 | 8 | Verify that insecure block modes (e.g., ECB) and weak padding schemes (e.g., PKCS#1 v1.5) are not used. |
| 11.3.2 | 8 | Verify that only approved ciphers and modes such as AES with GCM are used. |
| 11.4.1 | 8 | Verify that only approved hash functions are used for general cryptographic use cases, including digital signatures, HMAC, KDF, and random bit generation. Disallowed hash functions, such as MD5, must not be used for any cryptographic purpose. |
| 12.1.1 | 8 | Verify that only the latest recommended versions of the TLS protocol are enabled, such as TLS 1.2 and TLS 1.3. The latest version of the TLS protocol must be the preferred option. |
| 12.2.1 | 8 | Verify that TLS is used for all connectivity between a client and external facing, HTTP-based services, and does not fall back to insecure or unencrypted communications. |
| 12.2.2 | 8 | Verify that external facing services use publicly trusted TLS certificates. |
| 13.4.1 | 13 | Verify that the application is deployed either without any source control metadata, including the .git or .svn folders, or in a way that these folders are inaccessible both externally and to the application itself. |
| 14.2.1 | 8 | Verify that sensitive data is only sent to the server in the HTTP message body or header fields, and that the URL and query string do not contain sensitive information, such as an API key or session token. |
| 15.1.1 | 8 | Verify that application documentation defines risk based remediation time frames for 3rd party component versions with vulnerabilities and for updating libraries in general, to minimize the risk from these components. |
| 15.2.1 | 8 | Verify that the application only contains components which have not breached the documented update and remediation time frames. |

### Attacks from another website

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 3.4.2 | 17 | Verify that the Cross-Origin Resource Sharing (CORS) Access-Control-Allow-Origin header field is a fixed value by the application, or if the Origin HTTP request header field value is used, it is validated against an allowlist of trusted origins. When 'Access-Control-Allow-Origin: *' needs to be used, verify that the response does not include any sensitive information. |
| 3.5.1 | 17 | Verify that, if the application does not rely on the CORS preflight mechanism to prevent disallowed cross-origin requests to use sensitive functionality, these requests are validated to ensure they originate from the application itself. This may be done by using and validating anti-forgery tokens or requiring extra HTTP header fields that are not CORS-safelisted request-header fields. This is to defend against browser-based request forgery attacks, commonly known as cross-site request forgery (CSRF). |
| 3.5.2 | 17 | Verify that, if the application relies on the CORS preflight mechanism to prevent disallowed cross-origin use of sensitive functionality, it is not possible to call the functionality with a request which does not trigger a CORS-preflight request. This may require checking the values of the 'Origin' and 'Content-Type' request header fields or using an extra header field that is not a CORS-safelisted header-field. |
| 3.5.3 | 17 | Verify that HTTP requests to sensitive functionality use appropriate HTTP methods such as POST, PUT, PATCH, or DELETE, and not methods defined by the HTTP specification as "safe" such as HEAD, OPTIONS, or GET. Alternatively, strict validation of the Sec-Fetch-* request header fields can be used to ensure that the request did not originate from an inappropriate cross-origin call, a navigation request, or a resource load (such as an image source) where this is not expected. |

### Staff sign-in

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 6.1.1 | 18 | Verify that application documentation defines how controls such as rate limiting, anti-automation, and adaptive response, are used to defend against attacks such as credential stuffing and password brute force. The documentation must make clear how these controls are configured and prevent malicious account lockout. |
| 6.2.1 | 18 | Verify that user set passwords are at least 8 characters in length although a minimum of 15 characters is strongly recommended. |
| 6.2.2 | 18 | Verify that users can change their password. |
| 6.2.3 | 18 | Verify that password change functionality requires the user's current and new password. |
| 6.2.4 | 18 | Verify that passwords submitted during account registration or password change are checked against an available set of, at least, the top 3000 passwords which match the application's password policy, e.g. minimum length. |
| 6.2.5 | 18 | Verify that passwords of any composition can be used, without rules limiting the type of characters permitted. There must be no requirement for a minimum number of upper or lower case characters, numbers, or special characters. |
| 6.2.6 | 18 | Verify that password input fields use type=password to mask the entry. Applications may allow the user to temporarily view the entire masked password, or the last typed character of the password. |
| 6.2.7 | 18 | Verify that "paste" functionality, browser password helpers, and external password managers are permitted. |
| 6.2.8 | 18 | Verify that the application verifies the user's password exactly as received from the user, without any modifications such as truncation or case transformation. |
| 6.3.1 | 18 | Verify that controls to prevent attacks such as credential stuffing and password brute force are implemented according to the application's security documentation. |
| 6.3.2 | 18 | Verify that default user accounts (e.g., "root", "admin", or "sa") are not present in the application or are disabled. |
| 6.4.1 | 18 | Verify that system generated initial passwords or activation codes are securely randomly generated, follow the existing password policy, and expire after a short period of time or after they are initially used. These initial secrets must not be permitted to become the long term password. |
| 6.4.2 | 18 | Verify that password hints or knowledge-based authentication (so-called "secret questions") are not present. |

### Connector access

| ASVS 5.0.0 | Exercise | Review criterion |
|---|---|---|
| 9.1.1 | 4 | Verify that self-contained tokens are validated using their digital signature or MAC to protect against tampering before accepting the token's contents. |
| 9.1.2 | 4 | Verify that only algorithms on an allowlist can be used to create and verify self-contained tokens, for a given context. The allowlist must include the permitted algorithms, ideally only either symmetric or asymmetric algorithms, and must not include the 'None' algorithm. If both symmetric and asymmetric must be supported, additional controls will be needed to prevent key confusion. |
| 9.1.3 | 4 | Verify that key material that is used to validate self-contained tokens is from trusted pre-configured sources for the token issuer, preventing attackers from specifying untrusted sources and keys. For JWTs and other JWS structures, headers such as 'jku', 'x5u', and 'jwk' must be validated against an allowlist of trusted sources. |
| 9.2.1 | 4 | Verify that, if a validity time span is present in the token data, the token and its content are accepted only if the verification time is within this validity time span. For example, for JWTs, the claims 'nbf' and 'exp' must be verified. |
| 10.4.1 | 4 | Verify that the authorization server validates redirect URIs based on a client-specific allowlist of pre-registered URIs using exact string comparison. |
| 10.4.2 | 4 | Verify that, if the authorization server returns the authorization code in the authorization response, it can be used only once for a token request. For the second valid request with an authorization code that has already been used to issue an access token, the authorization server must reject a token request and revoke any issued tokens related to the authorization code. |
| 10.4.3 | 4 | Verify that the authorization code is short-lived. The maximum lifetime can be up to 10 minutes for L1 and L2 applications and up to 1 minute for L3 applications. |
| 10.4.4 | 3 | Verify that for a given client, the authorization server only allows the usage of grants that this client needs to use. Note that the grants 'token' (Implicit flow) and 'password' (Resource Owner Password Credentials flow) must no longer be used. |
| 10.4.5 | 4 | Verify that the authorization server mitigates refresh token replay attacks for public clients, preferably using sender-constrained refresh tokens, i.e., Demonstrating Proof of Possession (DPoP) or Certificate-Bound Access Tokens using mutual TLS (mTLS). For L1 and L2 applications, refresh token rotation may be used. If refresh token rotation is used, the authorization server must invalidate the refresh token after usage, and revoke all refresh tokens for that authorization if an already used and invalidated refresh token is provided. |

Requirement text: [OWASP Application Security Verification Standard 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0_release), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Groupings and exercise guidance are SecDash adaptations.
