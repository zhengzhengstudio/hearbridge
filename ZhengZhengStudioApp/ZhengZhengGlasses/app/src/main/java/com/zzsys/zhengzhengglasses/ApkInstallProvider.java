package com.zzsys.zhengzhengglasses;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

public class ApkInstallProvider extends ContentProvider {
    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File apk = resolveApk(uri);
        return ParcelFileDescriptor.open(apk, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    private File resolveApk(Uri uri) throws FileNotFoundException {
        if (getContext() == null) throw new FileNotFoundException("No context");
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..") || !name.endsWith(".apk")) {
            throw new FileNotFoundException("Invalid APK name");
        }

        File downloads = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File apk = downloads == null ? null : new File(downloads, name);
        if (apk == null || !apk.exists()) {
            apk = new File(getContext().getCacheDir(), name);
        }
        if (!apk.exists()) throw new FileNotFoundException(name);
        return apk;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File apk = resolveApk(uri);
            MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            cursor.addRow(new Object[]{apk.getName(), apk.length()});
            return cursor;
        } catch (FileNotFoundException error) {
            return null;
        }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
