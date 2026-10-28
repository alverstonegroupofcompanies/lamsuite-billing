<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

class SetUserPinCommand extends Command
{
    protected $signature = 'users:set-pin {user : User ID, username, or email} {pin : 4 to 6 digit numeric PIN}';
    protected $description = 'Set or reset quick PIN for a user and clear any active lockout';

    public function handle(): int
    {
        $target = $this->argument('user');
        $pin = (string)$this->argument('pin');

        $pinError = User::validatePinPolicy($pin);
        if ($pinError) {
            $this->error($pinError);
            return 1;
        }

        $user = is_numeric($target)
            ? User::find($target)
            : User::where('username', $target)->orWhere('email', $target)->first();

        if (!$user) {
            $this->error("User not found: '{$target}'");
            return 1;
        }

        $user->update([
            'pin_hash' => Hash::make($pin),
            'locked_until' => null,
            'failed_login_attempts' => 0,
        ]);

        $this->info("PIN for user '{$user->name}' (Username: {$user->username}) updated to '{$pin}'. Lockout cleared.");
        return 0;
    }
}
