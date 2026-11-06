plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zzsys.ciwawa"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zzsys.ciwawa"
        minSdk = 24
        targetSdk = 36
        versionCode = 15
        versionName = "0.2.5"

        buildConfigField("String", "APP_UPDATE_ID", "\"ciwawa-android\"")
        buildConfigField("String", "SITE_URL", "\"https://ciwawa.zhengzhengstudio.cn/\"")
        buildConfigField("String", "CHECKIN_URL", "\"https://ciwawa.zhengzhengstudio.cn/checkin.html\"")
        buildConfigField("String", "CONTACTS_URL", "\"https://ciwawa.zhengzhengstudio.cn/chat.html\"")
        buildConfigField("String", "POINTS_URL", "\"https://ciwawa.zhengzhengstudio.cn/points.html\"")
        buildConfigField("String", "PROFILE_URL", "\"https://ciwawa.zhengzhengstudio.cn/profile.html\"")
        buildConfigField("String", "DOWNLOADS_URL", "\"https://ciwawa.zhengzhengstudio.cn/downloads.html\"")
        buildConfigField("String", "MANIFEST_URL", "\"https://zhengzhengstudio.cn/api/apps/manifest.json\"")

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
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
