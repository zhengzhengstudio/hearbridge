plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.zzsys.managerportal"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zzsys.managerportal"
        minSdk = 24
        targetSdk = 36
        versionCode = 14
        versionName = "1.5.2"

        buildConfigField("String", "APP_UPDATE_ID", "\"manager-portal-android\"")
        buildConfigField("String", "DOWNLOADS_URL", "\"https://zhengzhengstudio.cn/downloads.html\"")
        buildConfigField("String", "NOTIFICATION_FEED_URL", "\"https://zhengzhengstudio.cn/api/manager/notifications?limit=20\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {}
