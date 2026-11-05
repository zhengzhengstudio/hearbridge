plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zzsys.zhengzhengglasses"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zzsys.zhengzhengglasses"
        minSdk = 24
        targetSdk = 36
        versionCode = 24
        versionName = "0.1.23"

        buildConfigField("String", "APP_UPDATE_ID", "\"zhengzheng-glasses-android\"")
        buildConfigField("String", "MANIFEST_URL", "\"https://zhengzhengstudio.cn/api/apps/manifest.json\"")
        buildConfigField("boolean", "STORE_DISTRIBUTION", "false")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("website") {
            dimension = "distribution"
            buildConfigField("boolean", "STORE_DISTRIBUTION", "false")
        }
        create("store") {
            dimension = "distribution"
            buildConfigField("boolean", "STORE_DISTRIBUTION", "true")
        }
    }

    signingConfigs {
        create("releaseLocal") {
            storeFile = file("../manual-build/release-key.jks")
            storePassword = "zhengzheng"
            keyAlias = "zhengzhengglasses"
            keyPassword = "zhengzheng"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("releaseLocal")
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
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    exclude("**/* 2.kt")
}

dependencies {

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mediapipe.tasks.vision)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
