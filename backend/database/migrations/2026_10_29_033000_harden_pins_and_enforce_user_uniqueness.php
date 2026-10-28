<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Migrate readable pin_code values into salted bcrypt pin_hash if not already hashed
        if (Schema::hasColumn('users', 'pin_code')) {
            $usersWithPins = DB::table('users')->whereNotNull('pin_code')->get();
            foreach ($usersWithPins as $user) {
                // If pin_hash is empty or needs update, hash it
                if (empty($user->pin_hash) && !empty($user->pin_code)) {
                    DB::table('users')
                        ->where('id', $user->id)
                        ->update(['pin_hash' => Hash::make($user->pin_code)]);
                }
            }

            // Permanently drop reversible pin_code column
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('pin_code');
            });
        }

        // 2. Resolve cross-field collisions between username and email
        // Specifically resolve collision where Muhammad Anshad username matched System Administrator email
        $collidingUsers = DB::table('users')->get();
        $emails = $collidingUsers->pluck('email')->toArray();

        foreach ($collidingUsers as $u) {
            if ($u->username && in_array($u->username, $emails) && $u->email !== $u->username) {
                // Change username to resolve cross-collision
                $cleanPrefix = explode('@', $u->email)[0];
                $newUsername = $cleanPrefix === 'admin' ? "store{$u->store_id}_owner" : $cleanPrefix;
                
                // Ensure unique
                $counter = 1;
                $candidate = $newUsername;
                while (DB::table('users')->where('username', $candidate)->where('id', '!=', $u->id)->exists()) {
                    $candidate = "{$newUsername}_{$counter}";
                    $counter++;
                }

                DB::table('users')->where('id', $u->id)->update(['username' => $candidate]);
            }
        }

        // 3. Ensure all usernames are unique
        // Add unique constraint to username column if not already present
        try {
            $existingIndexes = collect(Schema::getIndexes('users'))->pluck('name')->toArray();
            if (!in_array('users_username_unique', $existingIndexes, true)) {
                Schema::table('users', function (Blueprint $table) {
                    $table->unique('username');
                });
            }
        } catch (\Throwable $e) {
            // Index might already exist or driver doesn't support getIndexes
        }

        // 4. Reset any lockouts caused by previous misattribution
        DB::table('users')->update([
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasColumn('users', 'pin_code')) {
            Schema::table('users', function (Blueprint $table) {
                $table->text('pin_code')->nullable()->after('pin_hash');
            });
        }
    }
};
