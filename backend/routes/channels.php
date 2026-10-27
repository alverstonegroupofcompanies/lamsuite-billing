<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

Broadcast::channel('store.{storeId}', function ($user, $storeId) {
    return (int) $user->store_id === (int) $storeId;
});
