/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package xyz.mimirmarkets.app;

import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import java.net.HttpURLConnection;
import java.net.URL;



public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    

    

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (isWalletReturn() && !isFinishing()) {
            relayWalletReturn(getIntent().getData());
            finish();
            return;
        }
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    /** A wallet's answer (Phantom / Solflare deeplink), not a page to open. */
    private boolean isWalletReturn() {
        Uri uri = getIntent() == null ? null : getIntent().getData();
        return uri != null && "/api/wallet-return".equals(uri.getPath());
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return !isWalletReturn();
    }

    /** Hands the answer to the server, off the main thread; the waiting page polls for it. */
    private void relayWalletReturn(final Uri uri) {
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(uri.toString()).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(15000);
                c.getResponseCode();
            } catch (Exception ignored) {
                // The page times out and says so; nothing to recover here.
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url.
        Uri uri = super.getLaunchingUrl();

        

        return uri;
    }
}
