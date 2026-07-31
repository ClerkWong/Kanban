package com.wongchambers.kanban;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureConfig")
public class SecureConfigPlugin extends Plugin {
    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "com.wongchambers.kanban.sync-config.v1";
    private static final String PREFERENCES = "secure_sync_config_v1";
    private static final String ENCRYPTED_VALUE = "encrypted_value";
    private static final String SEPARATOR = ".";
    private static final int GCM_TAG_BITS = 128;

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEY_STORE);
        store.load(null);
        return store;
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = keyStore();
        if (store.containsAlias(KEY_ALIAS)) {
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEY_STORE
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }

    @PluginMethod
    public synchronized void load(PluginCall call) {
        String encrypted = preferences().getString(ENCRYPTED_VALUE, null);
        JSObject result = new JSObject();
        if (encrypted == null) {
            call.resolve(result);
            return;
        }
        try {
            String[] parts = encrypted.split("\\.", 2);
            if (parts.length != 2) {
                throw new IllegalStateException("Invalid secure config payload");
            }
            KeyStore store = keyStore();
            if (!store.containsAlias(KEY_ALIAS)) {
                // Android backup may restore ciphertext without its device-bound key.
                preferences().edit().remove(ENCRYPTED_VALUE).commit();
                call.resolve(result);
                return;
            }
            SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(parts[0], Base64.NO_WRAP))
            );
            byte[] plaintext = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            result.put("value", new String(plaintext, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            call.reject(
                "無法讀取安全同步憑證。",
                "secure_config_read_failed",
                error
            );
        }
    }

    @PluginMethod
    public synchronized void save(PluginCall call) {
        String value = call.getString("value");
        if (value == null) {
            call.reject("缺少同步憑證內容。", "secure_config_value_required");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            String encrypted =
                Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) +
                SEPARATOR +
                Base64.encodeToString(
                    cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),
                    Base64.NO_WRAP
                );
            if (!preferences().edit().putString(ENCRYPTED_VALUE, encrypted).commit()) {
                throw new IllegalStateException("Secure config commit failed");
            }
            call.resolve();
        } catch (Exception error) {
            call.reject(
                "無法保存安全同步憑證。",
                "secure_config_write_failed",
                error
            );
        }
    }

    @PluginMethod
    public synchronized void clear(PluginCall call) {
        if (!preferences().edit().remove(ENCRYPTED_VALUE).commit()) {
            call.reject(
                "無法清除安全同步憑證。",
                "secure_config_clear_failed"
            );
            return;
        }
        try {
            KeyStore store = keyStore();
            if (store.containsAlias(KEY_ALIAS)) {
                store.deleteEntry(KEY_ALIAS);
            }
        } catch (Exception ignored) {
            // The encrypted token is already gone. An orphaned device-bound key
            // contains no credential data and must not make logout appear to fail.
        }
        call.resolve();
    }
}
