# Inbox Zero Email Tracking Integration

## Files to Modify

### 1. Add Environment Variables

Add to `.env`:
```env
# Email Tracking
EMAIL_TRACKING_ENABLED=true
EMAIL_TRACKER_API_URL=https://t.affordablesolar.io
```

### 2. Modify `apps/web/utils/gmail/mail.ts`

#### Add Import at Top
```typescript
import {
  addTrackingToEmail,
  parseRecipients,
} from "@/utils/email-tracking/tracker";
import { nanoid } from "nanoid";
```

#### Modify `sendEmailWithHtml` Function

**Before:**
```typescript
export async function sendEmailWithHtml(
  gmail: gmail_v1.Gmail,
  body: SendEmailBody,
) {
  ensureEmailSendingEnabled();

  let messageText: string;

  try {
    messageText = convertEmailHtmlToText({ htmlText: body.messageHtml });
  } catch (error) {
    logger.error("Error converting email html to text", { error });
    messageText = body.messageHtml.replace(/<[^>]*>/g, "");
  }

  const raw = await createRawMailMessage({ ...body, messageText });
  const result = await withGmailRetry(() =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: {
        threadId: body.replyToEmail ? body.replyToEmail.threadId : undefined,
        raw,
      },
    }),
  );
  return result;
}
```

**After:**
```typescript
export async function sendEmailWithHtml(
  gmail: gmail_v1.Gmail,
  body: SendEmailBody,
) {
  ensureEmailSendingEnabled();

  // Generate unique email ID for tracking
  const emailId = nanoid(16);

  // Inject tracking pixel into HTML
  const recipients = parseRecipients(body.to, body.cc, body.bcc);
  const trackedHtml = await addTrackingToEmail(
    body.messageHtml,
    emailId,
    recipients,
    body.subject,
  );

  let messageText: string;

  try {
    messageText = convertEmailHtmlToText({ htmlText: body.messageHtml }); // Use original HTML for text
  } catch (error) {
    logger.error("Error converting email html to text", { error });
    messageText = body.messageHtml.replace(/<[^>]*>/g, "");
  }

  const raw = await createRawMailMessage({
    ...body,
    messageHtml: trackedHtml, // Use tracked HTML
    messageText,
  });

  const result = await withGmailRetry(() =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: {
        threadId: body.replyToEmail ? body.replyToEmail.threadId : undefined,
        raw,
      },
    }),
  );

  logger.info("Email sent with tracking", { emailId, recipients });

  return result;
}
```

### 3. Add `nanoid` Dependency

```bash
cd apps/web
pnpm add nanoid
```

### 4. Copy Tracker Module

Copy the file:
- From: `/tmp/inbox-zero/apps/web/utils/email-tracking/tracker.ts`
- To your forked Inbox Zero repo

## Full Modified mail.ts

Here's the complete modified file for reference:

```typescript
import { z } from "zod";
import type { gmail_v1 } from "@googleapis/gmail";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";
import type { Attachment } from "nodemailer/lib/mailer";
import { nanoid } from "nanoid";
import { zodAttachment } from "@/utils/types/mail";
import { convertEmailHtmlToText } from "@/utils/mail";
import {
  forwardEmailHtml,
  forwardEmailSubject,
  forwardEmailText,
} from "@/utils/gmail/forward";
import type { ParsedMessage } from "@/utils/types";
import { createReplyContent } from "@/utils/gmail/reply";
import type { EmailForAction } from "@/utils/ai/types";
import { createScopedLogger } from "@/utils/logger";
import { withGmailRetry } from "@/utils/gmail/retry";
import {
  buildReplyAllRecipients,
  formatCcList,
  mergeAndDedupeRecipients,
} from "@/utils/email/reply-all";
import { formatReplySubject } from "@/utils/email/subject";
import { ensureEmailSendingEnabled } from "@/utils/mail";
import {
  addTrackingToEmail,
  parseRecipients,
} from "@/utils/email-tracking/tracker";

const logger = createScopedLogger("gmail/mail");

// ... rest of the file stays the same until sendEmailWithHtml ...

export async function sendEmailWithHtml(
  gmail: gmail_v1.Gmail,
  body: SendEmailBody,
) {
  ensureEmailSendingEnabled();

  // Generate unique email ID for tracking
  const emailId = nanoid(16);

  // Inject tracking pixel into HTML
  const recipients = parseRecipients(body.to, body.cc, body.bcc);
  const trackedHtml = await addTrackingToEmail(
    body.messageHtml,
    emailId,
    recipients,
    body.subject,
  );

  let messageText: string;

  try {
    messageText = convertEmailHtmlToText({ htmlText: body.messageHtml });
  } catch (error) {
    logger.error("Error converting email html to text", { error });
    messageText = body.messageHtml.replace(/<[^>]*>/g, "");
  }

  const raw = await createRawMailMessage({
    ...body,
    messageHtml: trackedHtml,
    messageText,
  });

  const result = await withGmailRetry(() =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: {
        threadId: body.replyToEmail ? body.replyToEmail.threadId : undefined,
        raw,
      },
    }),
  );

  logger.info("Email sent with tracking", { emailId, recipients });

  return result;
}

// ... rest of file unchanged ...
```

## Testing

1. Start the tracking server:
   ```bash
   cd /Users/Eric/Projects/email-tracker
   npm start
   ```

2. Set environment variables for Inbox Zero:
   ```bash
   export EMAIL_TRACKING_ENABLED=true
   export EMAIL_TRACKER_API_URL=http://localhost:3001
   ```

3. Send a test email from Inbox Zero

4. Check the dashboard at http://localhost:3001/ to see tracked emails

5. Open the email from the recipient's inbox - the dashboard should update to show "Opened"
