<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class PasswordResetMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $recipientName,
        public string $resetUrl,
        public string $resetToken,
        public int $ttlMinutes,
    ) {
    }

    public function build(): self
    {
        $name = e($this->recipientName);
        $url = e($this->resetUrl);
        $token = e($this->resetToken);

        $html = <<<HTML
<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <h2 style="margin:0 0 12px;font-size:18px">Reset your LamSuite password</h2>
  <p style="font-size:14px;line-height:1.6">Hi {$name},</p>
  <p style="font-size:14px;line-height:1.6">
    We received a request to reset your LamSuite Admin password. Click the button below to choose a new password.
    This link expires in {$this->ttlMinutes} minutes.
  </p>
  <p style="margin:24px 0">
    <a href="{$url}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Reset password</a>
  </p>
  <p style="font-size:12px;color:#475569;line-height:1.6">
    If the button does not work, open the admin panel and enter this reset code manually:<br>
    <code style="display:inline-block;margin-top:6px;padding:6px 10px;background:#f1f5f9;border-radius:6px;font-family:monospace">{$token}</code>
  </p>
  <p style="font-size:12px;color:#64748b;line-height:1.6">
    If you did not request this reset, you can safely ignore this email — your password will not change.
  </p>
</div>
HTML;

        return $this->subject('Reset your LamSuite password')->html($html);
    }
}
